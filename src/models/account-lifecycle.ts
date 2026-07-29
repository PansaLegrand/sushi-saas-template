import { randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  accounts,
  adminAuditLogs,
  affiliateDeduplicationArchive,
  affiliates,
  authEvents,
  credits,
  emailBlocklist,
  feedbacks,
  files,
  jobs,
  orders,
  organizations,
  orgInvitations,
  orgMembers,
  privacyRequests,
  reservations,
  sessions,
  stripeWebhookEvents,
  subscriptions,
  tasks,
  twoFactor,
  users,
  verifications,
} from "@/db/schema";

export type PrivacyRequestRow = typeof privacyRequests.$inferSelect;
export type PrivacyRequestType = "export" | "erasure";
export type PrivacyRequestStatus =
  | "scheduled"
  | "processing"
  | "blocked"
  | "completed"
  | "canceled"
  | "failed";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export type LifecycleOwnerBlocker = {
  kind: "owner_transfer";
  organizations: Array<{ uuid: string; slug: string; name: string }>;
};

export type LifecycleAdminBlocker = {
  kind: "admin_continuity";
};

export type LifecycleBlocker = LifecycleOwnerBlocker | LifecycleAdminBlocker;

export type LifecycleMembership = {
  member: typeof orgMembers.$inferSelect;
  organization: typeof organizations.$inferSelect;
  memberCount: number;
  activeOtherOwnerCount: number;
};

export type CreatePrivacyRequestResult =
  | { outcome: "created" | "reused" | "active"; request: PrivacyRequestRow }
  | {
      outcome: "blocked";
      request: PrivacyRequestRow;
      blockers: LifecycleBlocker[];
    }
  | { outcome: "conflict" }
  | { outcome: "account_erasing" }
  | { outcome: "not_found" };

export type BeginPrivacyRequestResult =
  | {
      outcome: "started";
      request: PrivacyRequestRow;
      user: typeof users.$inferSelect;
    }
  | { outcome: "blocked"; blockers: LifecycleBlocker[] }
  | { outcome: "terminal" | "not_due" | "not_found" };

export type PrivacyExternalEffect =
  | "stripeSubscriptions"
  | "stripeCustomers"
  | "storageFiles"
  | "exportArtifacts"
  | "taskOutputs";

export type PrivacyExternalState = Record<PrivacyExternalEffect, string[]>;

const ACTIVE_ERASURE_STATUSES: PrivacyRequestStatus[] = [
  "scheduled",
  "processing",
  "failed",
];

function emptyExternalState(): PrivacyExternalState {
  return {
    stripeSubscriptions: [],
    stripeCustomers: [],
    storageFiles: [],
    exportArtifacts: [],
    taskOutputs: [],
  };
}

export function parsePrivacyExternalState(
  raw: string | null | undefined,
): PrivacyExternalState {
  if (!raw) return emptyExternalState();

  try {
    const parsed = JSON.parse(raw) as Partial<PrivacyExternalState>;
    return {
      stripeSubscriptions: Array.isArray(parsed.stripeSubscriptions)
        ? parsed.stripeSubscriptions.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      stripeCustomers: Array.isArray(parsed.stripeCustomers)
        ? parsed.stripeCustomers.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      storageFiles: Array.isArray(parsed.storageFiles)
        ? parsed.storageFiles.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      exportArtifacts: Array.isArray(parsed.exportArtifacts)
        ? parsed.exportArtifacts.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      taskOutputs: Array.isArray(parsed.taskOutputs)
        ? parsed.taskOutputs.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    };
  } catch {
    return emptyExternalState();
  }
}

function parseBlockers(raw: string | null): LifecycleBlocker[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? (value as LifecycleBlocker[]) : [];
  } catch {
    return [];
  }
}

async function lockLifecycleUser(tx: Tx, userId: string, userUuid: string) {
  await tx.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`account-lifecycle:${userId}`}, 0::bigint)
    )
  `);

  const [user] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.uuid, userUuid)))
    .limit(1)
    .for("update");

  return user;
}

async function listLifecycleMemberships(
  tx: Tx,
  userId: string,
): Promise<LifecycleMembership[]> {
  const rows = await tx
    .select({
      member: orgMembers,
      organization: organizations,
      memberCount: sql<number>`
        (select count(*)::int from ${orgMembers} all_members
          where all_members.organization_id = ${organizations.id})
      `,
      activeOtherOwnerCount: sql<number>`
        (select count(*)::int
          from ${orgMembers} owners
          inner join ${users} owner_users on owner_users.id = owners.user_id
          where owners.organization_id = ${organizations.id}
            and owners.role = 'owner'
            and owners.user_id <> ${userId}
            and owner_users.lifecycle_status = 'active'
            and owner_users.banned_at is null)
      `,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.organization_id))
    .where(eq(orgMembers.user_id, userId));

  return rows.map((row) => ({
    ...row,
    memberCount: Number(row.memberCount),
    activeOtherOwnerCount: Number(row.activeOtherOwnerCount),
  }));
}

async function getLifecycleBlockers(
  tx: Tx,
  user: typeof users.$inferSelect,
  memberships?: LifecycleMembership[],
): Promise<LifecycleBlocker[]> {
  const rows = memberships ?? (await listLifecycleMemberships(tx, user.id));
  const ownerOrganizations = rows
    .filter(
      ({ member, organization, memberCount, activeOtherOwnerCount }) =>
        member.role === "owner" &&
        activeOtherOwnerCount === 0 &&
        // A one-person personal workspace is the account container and is
        // intentionally torn down with the account.
        !(organization.is_personal && memberCount === 1),
    )
    .map(({ organization }) => ({
      uuid: organization.uuid,
      slug: organization.slug,
      name: organization.name,
    }));

  const blockers: LifecycleBlocker[] = [];
  if (ownerOrganizations.length > 0) {
    blockers.push({
      kind: "owner_transfer",
      organizations: ownerOrganizations,
    });
  }

  if (user.role === "admin_rw") {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.role, "admin_rw"),
          ne(users.id, user.id),
          eq(users.lifecycle_status, "active"),
          isNull(users.banned_at),
        ),
      );
    if (Number(row?.count ?? 0) === 0) {
      blockers.push({ kind: "admin_continuity" });
    }
  }

  return blockers;
}

export async function createPrivacyRequest(input: {
  uuid: string;
  requestType: PrivacyRequestType;
  userId: string;
  userUuid: string;
  idempotencyKey: string;
  fingerprint: string;
  scheduledAt: Date;
  erasedSubjectUuid: string;
  jobUuid: string;
  maxAttempts: number;
}): Promise<CreatePrivacyRequestResult> {
  return db().transaction(async (tx) => {
    const user = await lockLifecycleUser(tx, input.userId, input.userUuid);
    if (!user) return { outcome: "not_found" };
    if (user.lifecycle_status === "erasing") {
      return { outcome: "account_erasing" };
    }

    const [sameKey] = await tx
      .select()
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.user_uuid, input.userUuid),
          eq(privacyRequests.request_type, input.requestType),
          eq(privacyRequests.idempotency_key, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (sameKey) {
      if (sameKey.request_fingerprint !== input.fingerprint) {
        return { outcome: "conflict" };
      }
      return {
        outcome: "reused",
        request: sameKey,
        ...(sameKey.status === "blocked"
          ? { blockers: parseBlockers(sameKey.blockers_json) }
          : {}),
      } as CreatePrivacyRequestResult;
    }

    if (input.requestType === "erasure") {
      const [active] = await tx
        .select()
        .from(privacyRequests)
        .where(
          and(
            eq(privacyRequests.user_uuid, input.userUuid),
            eq(privacyRequests.request_type, "erasure"),
            inArray(privacyRequests.status, ACTIVE_ERASURE_STATUSES),
          ),
        )
        .orderBy(desc(privacyRequests.created_at))
        .limit(1);

      if (active) return { outcome: "active", request: active };

      const blockers = await getLifecycleBlockers(tx, user);
      if (blockers.length > 0) {
        const [request] = await tx
          .insert(privacyRequests)
          .values({
            uuid: input.uuid,
            request_type: input.requestType,
            user_id: input.userId,
            user_uuid: input.userUuid,
            status: "blocked",
            idempotency_key: input.idempotencyKey,
            request_fingerprint: input.fingerprint,
            erased_subject_uuid: input.erasedSubjectUuid,
            scheduled_at: input.scheduledAt,
            blockers_json: JSON.stringify(blockers),
          })
          .returning();

        return { outcome: "blocked", request, blockers };
      }
    }

    const [request] = await tx
      .insert(privacyRequests)
      .values({
        uuid: input.uuid,
        request_type: input.requestType,
        user_id: input.userId,
        user_uuid: input.userUuid,
        status: "scheduled",
        idempotency_key: input.idempotencyKey,
        request_fingerprint: input.fingerprint,
        erased_subject_uuid: input.erasedSubjectUuid,
        scheduled_at: input.scheduledAt,
      })
      .returning();

    await tx.insert(jobs).values({
      uuid: input.jobUuid,
      type:
        input.requestType === "export"
          ? "account_data_export"
          : "account_erasure",
      payload_json: JSON.stringify({ requestUuid: input.uuid }),
      run_at: input.scheduledAt,
      max_attempts: input.maxAttempts,
      dedupe_key: `${input.requestType === "export" ? "account_data_export" : "account_erasure"}:${input.uuid}`,
      subject_user_uuid: input.userUuid,
    });

    if (input.requestType === "erasure") {
      await tx
        .update(users)
        .set({
          lifecycle_status: "deletion_pending",
          deletion_requested_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(users.id, input.userId));
    }

    return { outcome: "created", request };
  });
}

export async function findPrivacyRequestForUser(input: {
  uuid: string;
  userUuid: string;
  requestType?: PrivacyRequestType;
}): Promise<PrivacyRequestRow | undefined> {
  const predicates = [
    eq(privacyRequests.uuid, input.uuid),
    eq(privacyRequests.user_uuid, input.userUuid),
  ];
  if (input.requestType) {
    predicates.push(eq(privacyRequests.request_type, input.requestType));
  }

  const [request] = await db()
    .select()
    .from(privacyRequests)
    .where(and(...predicates))
    .limit(1);
  return request;
}

export async function findPrivacyRequestByUuid(
  uuid: string,
): Promise<PrivacyRequestRow | undefined> {
  const [request] = await db()
    .select()
    .from(privacyRequests)
    .where(eq(privacyRequests.uuid, uuid))
    .limit(1);
  return request;
}

export async function findLatestErasureForUser(
  userUuid: string,
): Promise<PrivacyRequestRow | undefined> {
  const [request] = await db()
    .select()
    .from(privacyRequests)
    .where(
      and(
        eq(privacyRequests.user_uuid, userUuid),
        eq(privacyRequests.request_type, "erasure"),
      ),
    )
    .orderBy(desc(privacyRequests.created_at))
    .limit(1);
  return request;
}

export async function cancelScheduledErasure(input: {
  userId: string;
  userUuid: string;
}): Promise<"canceled" | "none" | "cannot_cancel"> {
  return db().transaction(async (tx) => {
    const user = await lockLifecycleUser(tx, input.userId, input.userUuid);
    if (!user) return "none";

    const [request] = await tx
      .select()
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.user_uuid, input.userUuid),
          eq(privacyRequests.request_type, "erasure"),
          inArray(privacyRequests.status, ACTIVE_ERASURE_STATUSES),
        ),
      )
      .orderBy(desc(privacyRequests.created_at))
      .limit(1)
      .for("update");

    if (!request) return "none";
    if (request.status !== "scheduled") return "cannot_cancel";

    const now = new Date();
    await tx
      .update(privacyRequests)
      .set({
        status: "canceled",
        canceled_at: now,
        updated_at: now,
      })
      .where(eq(privacyRequests.id, request.id));
    await tx
      .update(jobs)
      .set({
        status: "canceled",
        completed_at: now,
        updated_at: now,
      })
      .where(eq(jobs.dedupe_key, `account_erasure:${request.uuid}`));
    await tx
      .update(users)
      .set({
        lifecycle_status: "active",
        deletion_requested_at: null,
        updated_at: now,
      })
      .where(eq(users.id, input.userId));

    return "canceled";
  });
}

export async function beginPrivacyRequest(
  uuid: string,
  requestType: PrivacyRequestType,
): Promise<BeginPrivacyRequestResult> {
  return db().transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.uuid, uuid),
          eq(privacyRequests.request_type, requestType),
        ),
      )
      .limit(1)
      .for("update");

    if (!request) return { outcome: "not_found" };
    if (["completed", "canceled", "blocked"].includes(request.status)) {
      return { outcome: "terminal" };
    }
    if (request.scheduled_at.getTime() > Date.now()) {
      return { outcome: "not_due" };
    }

    const user = await lockLifecycleUser(
      tx,
      request.user_id,
      request.user_uuid,
    );
    if (!user) return { outcome: "not_found" };

    if (requestType === "export" && user.lifecycle_status === "erasing") {
      await tx
        .update(privacyRequests)
        .set({
          status: "canceled",
          canceled_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(privacyRequests.id, request.id));
      return { outcome: "terminal" };
    }

    if (requestType === "erasure") {
      const blockers = await getLifecycleBlockers(tx, user);
      if (blockers.length > 0) {
        const now = new Date();
        await tx
          .update(privacyRequests)
          .set({
            status: "blocked",
            blockers_json: JSON.stringify(blockers),
            updated_at: now,
          })
          .where(eq(privacyRequests.id, request.id));
        await tx
          .update(users)
          .set({
            lifecycle_status: "active",
            deletion_requested_at: null,
            updated_at: now,
          })
          .where(eq(users.id, user.id));
        return { outcome: "blocked", blockers };
      }

      // This is the irreversible boundary. Existing credentials are revoked in
      // the same transaction that closes the cancellation window; session
      // creation hooks reject replacements while `erasing`.
      await tx.delete(sessions).where(eq(sessions.user_id, user.id));
      await tx
        .update(users)
        .set({ lifecycle_status: "erasing", updated_at: new Date() })
        .where(eq(users.id, user.id));
    }

    const [started] = await tx
      .update(privacyRequests)
      .set({
        status: "processing",
        started_at: request.started_at ?? new Date(),
        attempts: request.attempts + 1,
        blockers_json: null,
        last_error: null,
        updated_at: new Date(),
      })
      .where(eq(privacyRequests.id, request.id))
      .returning();

    return { outcome: "started", request: started, user };
  });
}

export async function markPrivacyRequestFailed(
  uuid: string,
  error: string,
): Promise<void> {
  await db()
    .update(privacyRequests)
    .set({
      status: "failed",
      last_error: error.slice(0, 4000),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(privacyRequests.uuid, uuid),
        ne(privacyRequests.status, "completed"),
        ne(privacyRequests.status, "canceled"),
      ),
    );
}

export async function recordPrivacyExternalEffect(input: {
  requestUuid: string;
  effect: PrivacyExternalEffect;
  id: string;
}): Promise<void> {
  await db().transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.uuid, input.requestUuid))
      .limit(1)
      .for("update");
    if (!request) return;

    const state = parsePrivacyExternalState(request.external_state_json);
    if (!state[input.effect].includes(input.id)) {
      state[input.effect].push(input.id);
    }

    await tx
      .update(privacyRequests)
      .set({
        external_state_json: JSON.stringify(state),
        updated_at: new Date(),
      })
      .where(eq(privacyRequests.id, request.id));
  });
}

export type AccountExportSnapshot = {
  profile: Record<string, unknown>;
  organizations: unknown[];
  invitations: unknown[];
  orders: unknown[];
  credits: unknown[];
  affiliates: unknown[];
  affiliateDeduplicationArchive: unknown[];
  feedback: unknown[];
  reservations: unknown[];
  files: Array<Record<string, unknown> & { uuid: string }>;
  tasks: unknown[];
  authenticationHistory: unknown[];
  subscriptions: unknown[];
  auditHistory: unknown[];
  privacyRequests: unknown[];
};

export type AccountExportData = {
  snapshot: AccountExportSnapshot;
  fileObjects: Array<{
    uuid: string;
    bucket: string;
    key: string;
    filename: string;
    contentType: string;
    status: string;
  }>;
};

export async function getAccountExportData(input: {
  userId: string;
  userUuid: string;
}): Promise<AccountExportData | undefined> {
  return db().transaction(
    async (tx) => {
      const [user] = await tx
        .select({
          uuid: users.uuid,
          email: users.email,
          nickname: users.nickname,
          avatarUrl: users.avatar_url,
          locale: users.locale,
          signInProvider: users.signin_provider,
          emailVerified: users.email_verified,
          createdAt: users.created_at,
          updatedAt: users.updated_at,
        })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.uuid, input.userUuid)))
        .limit(1);
      if (!user) return undefined;

      const memberships = await tx
        .select({
          organizationUuid: organizations.uuid,
          organizationName: organizations.name,
          organizationSlug: organizations.slug,
          isPersonal: organizations.is_personal,
          role: orgMembers.role,
          joinedAt: orgMembers.created_at,
        })
        .from(orgMembers)
        .innerJoin(
          organizations,
          eq(organizations.id, orgMembers.organization_id),
        )
        .where(eq(orgMembers.user_id, input.userId));

      const invitations = await tx
        .select({
          id: orgInvitations.id,
          organizationId: orgInvitations.organization_id,
          email: orgInvitations.email,
          role: orgInvitations.role,
          status: orgInvitations.status,
          expiresAt: orgInvitations.expires_at,
          createdAt: orgInvitations.created_at,
        })
        .from(orgInvitations)
        .where(
          or(
            eq(orgInvitations.inviter_id, input.userId),
            sql`lower(${orgInvitations.email}) = lower(${user.email})`,
          ),
        );

      const orderRows = await tx
        .select({
          orderNo: orders.order_no,
          createdAt: orders.created_at,
          amount: orders.amount,
          interval: orders.interval,
          expiredAt: orders.expired_at,
          status: orders.status,
          credits: orders.credits,
          currency: orders.currency,
          productName: orders.product_name,
          paidAt: orders.paid_at,
          organizationUuid: orders.org_uuid,
        })
        .from(orders)
        .where(eq(orders.user_uuid, input.userUuid));

      const creditRows = await tx
        .select({
          transactionNo: credits.trans_no,
          createdAt: credits.created_at,
          type: credits.trans_type,
          amount: credits.credits,
          orderNo: credits.order_no,
          expiresAt: credits.expired_at,
          balanceAfter: credits.balance_after,
          organizationUuid: credits.org_uuid,
        })
        .from(credits)
        .where(eq(credits.user_uuid, input.userUuid));

      const affiliateRows = await tx
        .select({
          createdAt: affiliates.created_at,
          status: affiliates.status,
          referredUserUuid: affiliates.user_uuid,
          inviterUuid: affiliates.invited_by,
          orderNo: affiliates.paid_order_no,
          paidAmount: affiliates.paid_amount,
          rewardPercent: affiliates.reward_percent,
          rewardAmount: affiliates.reward_amount,
        })
        .from(affiliates)
        .where(
          or(
            eq(affiliates.user_uuid, input.userUuid),
            eq(affiliates.invited_by, input.userUuid),
          ),
        );

      const archivedAffiliateRows = await tx
        .select({
          archiveId: affiliateDeduplicationArchive.archive_id,
          originalAffiliateId:
            affiliateDeduplicationArchive.original_affiliate_id,
          canonicalAffiliateId:
            affiliateDeduplicationArchive.canonical_affiliate_id,
          reason: affiliateDeduplicationArchive.reason,
          originalRowJson: affiliateDeduplicationArchive.original_row_json,
          archivedAt: affiliateDeduplicationArchive.archived_at,
        })
        .from(affiliateDeduplicationArchive)
        .where(
          or(
            sql`${affiliateDeduplicationArchive.original_row_json}::jsonb ->> 'user_uuid' = ${input.userUuid}`,
            sql`${affiliateDeduplicationArchive.original_row_json}::jsonb ->> 'invited_by' = ${input.userUuid}`,
          ),
        );

      const feedbackRows = await tx
        .select({
          createdAt: feedbacks.created_at,
          status: feedbacks.status,
          content: feedbacks.content,
          rating: feedbacks.rating,
        })
        .from(feedbacks)
        .where(eq(feedbacks.user_uuid, input.userUuid));

      const reservationRows = await tx
        .select({
          reservationNo: reservations.reservation_no,
          serviceId: reservations.service_id,
          startsAt: reservations.start_at,
          endsAt: reservations.end_at,
          timezone: reservations.timezone,
          status: reservations.status,
          contactEmail: reservations.contact_email,
          contactPhone: reservations.contact_phone,
          notes: reservations.notes,
          createdAt: reservations.created_at,
          organizationUuid: reservations.org_uuid,
        })
        .from(reservations)
        .where(eq(reservations.user_uuid, input.userUuid));

      const fileRows = await tx
        .select({
          uuid: files.uuid,
          bucket: files.bucket,
          key: files.key,
          filename: files.original_filename,
          contentType: files.content_type,
          size: files.size,
          visibility: files.visibility,
          status: files.status,
          createdAt: files.created_at,
          updatedAt: files.updated_at,
          organizationUuid: files.org_uuid,
        })
        .from(files)
        .where(eq(files.user_uuid, input.userUuid));

      const taskRows = await tx
        .select({
          uuid: tasks.uuid,
          type: tasks.type,
          status: tasks.status,
          creditsUsed: tasks.credits_used,
          prompt: tasks.user_input,
          outputUrl: tasks.output_url,
          startedAt: tasks.started_at,
          completedAt: tasks.completed_at,
          createdAt: tasks.created_at,
          organizationUuid: tasks.org_uuid,
        })
        .from(tasks)
        .where(eq(tasks.user_uuid, input.userUuid));

      const eventRows = await tx
        .select({
          event: authEvents.event,
          provider: authEvents.provider,
          ipAddress: authEvents.ip_address,
          userAgent: authEvents.user_agent,
          createdAt: authEvents.created_at,
        })
        .from(authEvents)
        .where(eq(authEvents.user_uuid, input.userUuid));

      const subscriptionRows = await tx
        .select({
          uuid: subscriptions.uuid,
          priceId: subscriptions.stripe_price_id,
          tier: subscriptions.tier,
          status: subscriptions.status,
          source: subscriptions.source,
          periodStart: subscriptions.current_period_start,
          periodEnd: subscriptions.current_period_end,
          trialEnd: subscriptions.trial_end,
          cancelAtPeriodEnd: subscriptions.cancel_at_period_end,
          endedAt: subscriptions.ended_at,
          createdAt: subscriptions.created_at,
          organizationUuid: subscriptions.org_uuid,
        })
        .from(subscriptions)
        .where(eq(subscriptions.user_uuid, input.userUuid));

      const auditRows = await tx
        .select({
          action: adminAuditLogs.action,
          targetType: adminAuditLogs.target_type,
          status: adminAuditLogs.status,
          createdAt: adminAuditLogs.created_at,
        })
        .from(adminAuditLogs)
        .where(
          or(
            eq(adminAuditLogs.actor_uuid, input.userUuid),
            eq(adminAuditLogs.target_uuid, input.userUuid),
          ),
        );

      const requestRows = await tx
        .select({
          uuid: privacyRequests.uuid,
          type: privacyRequests.request_type,
          status: privacyRequests.status,
          scheduledAt: privacyRequests.scheduled_at,
          startedAt: privacyRequests.started_at,
          completedAt: privacyRequests.completed_at,
          canceledAt: privacyRequests.canceled_at,
          createdAt: privacyRequests.created_at,
        })
        .from(privacyRequests)
        .where(eq(privacyRequests.user_uuid, input.userUuid));

      return {
        snapshot: {
          profile: user,
          organizations: memberships,
          invitations,
          orders: orderRows,
          credits: creditRows,
          affiliates: affiliateRows,
          affiliateDeduplicationArchive: archivedAffiliateRows,
          feedback: feedbackRows,
          reservations: reservationRows,
          files: fileRows.map(
            ({
              bucket: _bucket,
              key: _key,
              filename,
              contentType,
              ...file
            }) => ({
              ...file,
              originalFilename: filename,
              contentType,
            }),
          ),
          tasks: taskRows,
          authenticationHistory: eventRows,
          subscriptions: subscriptionRows,
          auditHistory: auditRows,
          privacyRequests: requestRows,
        },
        fileObjects: fileRows.map(
          ({ uuid, bucket, key, filename, contentType, status }) => ({
            uuid,
            bucket,
            key,
            filename,
            contentType,
            status,
          }),
        ),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/**
 * Record the deterministic export location and its cleanup job before bytes
 * leave the process. If object storage accepts the upload but the database
 * completion write is interrupted, the artifact is still discoverable by
 * erasure and has a durable expiry path.
 */
export async function prepareAccountExportArtifact(input: {
  requestUuid: string;
  bucket: string;
  key: string;
  expiresAt: Date;
  cleanupJobUuid: string;
}): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.uuid, input.requestUuid),
          eq(privacyRequests.request_type, "export"),
        ),
      )
      .limit(1)
      .for("update");
    if (!request || request.status === "canceled") return false;
    if (request.status === "completed") return true;

    const [user] = await tx
      .select({ lifecycleStatus: users.lifecycle_status })
      .from(users)
      .where(eq(users.id, request.user_id))
      .limit(1);
    if (!user || user.lifecycleStatus === "erasing") {
      const now = new Date();
      await tx
        .update(privacyRequests)
        .set({
          status: "canceled",
          canceled_at: now,
          updated_at: now,
        })
        .where(eq(privacyRequests.id, request.id));
      return false;
    }

    await tx
      .update(privacyRequests)
      .set({
        export_bucket: input.bucket,
        export_key: input.key,
        export_expires_at: input.expiresAt,
        updated_at: new Date(),
      })
      .where(eq(privacyRequests.id, request.id));

    await tx
      .insert(jobs)
      .values({
        uuid: input.cleanupJobUuid,
        type: "account_export_expire",
        payload_json: JSON.stringify({ requestUuid: input.requestUuid }),
        run_at: input.expiresAt,
        max_attempts: 10,
        dedupe_key: `account_export_expire:${input.requestUuid}`,
        subject_user_uuid: request.user_uuid,
      })
      .onConflictDoNothing({ target: jobs.dedupe_key });

    return true;
  });
}

export async function completeAccountExport(input: {
  requestUuid: string;
  bucket: string;
  key: string;
  size: number;
  sha256: string;
  expiresAt: Date;
  cleanupJobUuid: string;
}): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.uuid, input.requestUuid))
      .limit(1)
      .for("update");
    if (!request || ["completed", "canceled"].includes(request.status)) {
      return request?.status === "completed";
    }

    const [user] = await tx
      .select({ lifecycleStatus: users.lifecycle_status })
      .from(users)
      .where(eq(users.id, request.user_id))
      .limit(1);
    if (!user || user.lifecycleStatus === "erasing") return false;

    const now = new Date();
    await tx
      .update(privacyRequests)
      .set({
        status: "completed",
        completed_at: now,
        export_bucket: input.bucket,
        export_key: input.key,
        export_size: input.size,
        export_sha256: input.sha256,
        export_expires_at: input.expiresAt,
        last_error: null,
        updated_at: now,
      })
      .where(eq(privacyRequests.id, request.id));

    await tx
      .insert(jobs)
      .values({
        uuid: input.cleanupJobUuid,
        type: "account_export_expire",
        payload_json: JSON.stringify({ requestUuid: input.requestUuid }),
        run_at: input.expiresAt,
        max_attempts: 10,
        dedupe_key: `account_export_expire:${input.requestUuid}`,
        subject_user_uuid: request.user_uuid,
      })
      .onConflictDoNothing({ target: jobs.dedupe_key });
    return true;
  });
}

export async function clearExpiredAccountExportArtifact(
  requestUuid: string,
): Promise<void> {
  await db()
    .update(privacyRequests)
    .set({
      export_bucket: null,
      export_key: null,
      export_size: null,
      export_sha256: null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(privacyRequests.uuid, requestUuid),
        eq(privacyRequests.request_type, "export"),
      ),
    );
}

export type AccountErasurePlan = {
  request: PrivacyRequestRow;
  user: typeof users.$inferSelect;
  blockers: LifecycleBlocker[];
  teardownOrganizations: Array<typeof organizations.$inferSelect>;
  sharedMemberships: LifecycleMembership[];
  stripeSubscriptions: Array<typeof subscriptions.$inferSelect>;
  stripeCustomerIds: string[];
  storedFiles: Array<typeof files.$inferSelect>;
  taskOutputs: Array<typeof tasks.$inferSelect>;
  exportArtifacts: Array<{
    requestUuid: string;
    bucket: string;
    key: string;
  }>;
};

export async function getAccountErasurePlan(
  requestUuid: string,
): Promise<AccountErasurePlan | undefined> {
  return db().transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.uuid, requestUuid),
          eq(privacyRequests.request_type, "erasure"),
        ),
      )
      .limit(1);
    if (!request) return undefined;

    const [user] = await tx
      .select()
      .from(users)
      .where(
        and(eq(users.id, request.user_id), eq(users.uuid, request.user_uuid)),
      )
      .limit(1);
    if (!user) return undefined;

    const memberships = await listLifecycleMemberships(tx, user.id);
    const blockers = await getLifecycleBlockers(tx, user, memberships);
    const teardownMemberships = memberships.filter(
      ({ organization, memberCount }) =>
        organization.is_personal && memberCount === 1,
    );
    const teardownOrganizations = teardownMemberships.map(
      ({ organization }) => organization,
    );
    const teardownOrgUuids = teardownOrganizations.map(({ uuid }) => uuid);

    const stripeSubscriptionRows =
      teardownOrgUuids.length > 0
        ? await tx
            .select()
            .from(subscriptions)
            .where(
              and(
                inArray(subscriptions.org_uuid, teardownOrgUuids),
                isNotNull(subscriptions.stripe_subscription_id),
                sql`${subscriptions.status} not in ('canceled', 'incomplete_expired')`,
              ),
            )
        : [];

    const storedFileRows =
      teardownOrgUuids.length > 0
        ? await tx
            .select()
            .from(files)
            .where(
              and(
                inArray(files.org_uuid, teardownOrgUuids),
                ne(files.status, "deleted"),
              ),
            )
        : [];

    const taskOutputRows =
      teardownOrgUuids.length > 0
        ? await tx
            .select()
            .from(tasks)
            .where(
              and(
                inArray(tasks.org_uuid, teardownOrgUuids),
                isNotNull(tasks.output_url),
              ),
            )
        : [];

    const exportRows = await tx
      .select({
        requestUuid: privacyRequests.uuid,
        bucket: privacyRequests.export_bucket,
        key: privacyRequests.export_key,
      })
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.user_uuid, user.uuid),
          eq(privacyRequests.request_type, "export"),
          isNotNull(privacyRequests.export_bucket),
          isNotNull(privacyRequests.export_key),
        ),
      );

    const customerIds = new Set<string>();
    if (user.stripe_customer_id) customerIds.add(user.stripe_customer_id);
    for (const organization of teardownOrganizations) {
      if (organization.stripe_customer_id) {
        customerIds.add(organization.stripe_customer_id);
      }
    }

    return {
      request,
      user,
      blockers,
      teardownOrganizations,
      sharedMemberships: memberships.filter(
        ({ organization }) => !teardownOrgUuids.includes(organization.uuid),
      ),
      stripeSubscriptions: stripeSubscriptionRows,
      stripeCustomerIds: [...customerIds],
      storedFiles: storedFileRows,
      taskOutputs: taskOutputRows,
      exportArtifacts: exportRows.filter(
        (
          row,
        ): row is {
          requestUuid: string;
          bucket: string;
          key: string;
        } => Boolean(row.bucket && row.key),
      ),
    };
  });
}

export type FinalizeErasureResult =
  | "completed"
  | "already_completed"
  | "blocked"
  | "external_pending"
  | "not_found";

function includesAll(completed: string[], required: string[]): boolean {
  const completedSet = new Set(completed);
  return required.every((value) => completedSet.has(value));
}

export async function finalizeAccountErasure(input: {
  requestUuid: string;
  requireStripeCustomerDeletion: boolean;
  retainSecurityBlocklistEntries: boolean;
}): Promise<FinalizeErasureResult> {
  return db().transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.uuid, input.requestUuid))
      .limit(1)
      .for("update");
    if (!request) return "not_found";
    if (request.status === "completed") return "already_completed";

    const user = await lockLifecycleUser(
      tx,
      request.user_id,
      request.user_uuid,
    );
    if (!user) return "not_found";

    const memberships = await listLifecycleMemberships(tx, user.id);
    const blockers = await getLifecycleBlockers(tx, user, memberships);
    if (blockers.length > 0) {
      await tx
        .update(privacyRequests)
        .set({
          status: "failed",
          blockers_json: JSON.stringify(blockers),
          updated_at: new Date(),
        })
        .where(eq(privacyRequests.id, request.id));
      return "blocked";
    }

    const teardownOrganizations = memberships
      .filter(
        ({ organization, memberCount }) =>
          organization.is_personal && memberCount === 1,
      )
      .map(({ organization }) => organization);
    const teardownOrgIds = teardownOrganizations.map(({ id }) => id);
    const teardownOrgUuids = teardownOrganizations.map(({ uuid }) => uuid);
    const state = parsePrivacyExternalState(request.external_state_json);

    const subscriptionRows =
      teardownOrgUuids.length > 0
        ? await tx
            .select({
              id: subscriptions.stripe_subscription_id,
            })
            .from(subscriptions)
            .where(
              and(
                inArray(subscriptions.org_uuid, teardownOrgUuids),
                isNotNull(subscriptions.stripe_subscription_id),
                sql`${subscriptions.status} not in ('canceled', 'incomplete_expired')`,
              ),
            )
        : [];
    const requiredSubscriptionIds = subscriptionRows
      .map(({ id }) => id)
      .filter((id): id is string => Boolean(id));

    const requiredCustomerIds = new Set<string>();
    if (user.stripe_customer_id)
      requiredCustomerIds.add(user.stripe_customer_id);
    for (const organization of teardownOrganizations) {
      if (organization.stripe_customer_id) {
        requiredCustomerIds.add(organization.stripe_customer_id);
      }
    }

    const remainingFiles =
      teardownOrgUuids.length > 0
        ? await tx
            .select({ uuid: files.uuid })
            .from(files)
            .where(
              and(
                inArray(files.org_uuid, teardownOrgUuids),
                ne(files.status, "deleted"),
              ),
            )
        : [];

    const taskOutputRows =
      teardownOrgUuids.length > 0
        ? await tx
            .select({ uuid: tasks.uuid })
            .from(tasks)
            .where(
              and(
                inArray(tasks.org_uuid, teardownOrgUuids),
                isNotNull(tasks.output_url),
              ),
            )
        : [];

    const exportRows = await tx
      .select({
        bucket: privacyRequests.export_bucket,
        key: privacyRequests.export_key,
      })
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.user_uuid, user.uuid),
          eq(privacyRequests.request_type, "export"),
          isNotNull(privacyRequests.export_bucket),
          isNotNull(privacyRequests.export_key),
        ),
      );
    const requiredExportArtifacts = exportRows
      .filter((row): row is { bucket: string; key: string } =>
        Boolean(row.bucket && row.key),
      )
      .map(({ bucket, key }) => `${bucket}/${key}`);

    if (
      remainingFiles.length > 0 ||
      !includesAll(state.stripeSubscriptions, requiredSubscriptionIds) ||
      (input.requireStripeCustomerDeletion &&
        !includesAll(state.stripeCustomers, [...requiredCustomerIds])) ||
      !includesAll(
        state.taskOutputs,
        taskOutputRows.map(({ uuid }) => uuid),
      ) ||
      !includesAll(state.exportArtifacts, requiredExportArtifacts)
    ) {
      return "external_pending";
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const erased = request.erased_subject_uuid ?? `erased-${randomUUID()}`;
    const erasedActor = `erased:${erased}`;

    await tx.delete(sessions).where(eq(sessions.user_id, user.id));
    await tx.delete(accounts).where(eq(accounts.user_id, user.id));
    await tx.delete(twoFactor).where(eq(twoFactor.user_id, user.id));
    await tx
      .delete(verifications)
      .where(
        or(
          eq(verifications.identifier, user.id),
          sql`lower(${verifications.identifier}) = lower(${user.email})`,
          eq(verifications.value, user.id),
        ),
      );

    if (teardownOrgIds.length > 0) {
      await tx
        .delete(orgInvitations)
        .where(inArray(orgInvitations.organization_id, teardownOrgIds));
    }
    await tx
      .delete(orgInvitations)
      .where(
        or(
          eq(orgInvitations.inviter_id, user.id),
          sql`lower(${orgInvitations.email}) = lower(${user.email})`,
        ),
      );
    await tx.delete(orgMembers).where(eq(orgMembers.user_id, user.id));

    for (const organization of teardownOrganizations) {
      await tx
        .update(organizations)
        .set({
          name: "Deleted workspace",
          slug: `deleted-${organization.uuid}`,
          logo: null,
          metadata: null,
          stripe_customer_id: null,
          is_personal: false,
          lifecycle_status: "deleted",
          deleted_at: now,
          updated_at: now,
        })
        .where(eq(organizations.id, organization.id));
    }

    const sharedPersonalOrgIds = memberships
      .filter(
        ({ organization }) =>
          organization.is_personal && !teardownOrgIds.includes(organization.id),
      )
      .map(({ organization }) => organization.id);
    if (sharedPersonalOrgIds.length > 0) {
      await tx
        .update(organizations)
        .set({ is_personal: false, updated_at: now })
        .where(inArray(organizations.id, sharedPersonalOrgIds));
    }

    await tx
      .update(orders)
      .set({
        user_uuid: erased,
        user_email: "",
        paid_email: null,
        order_detail: null,
        paid_detail: null,
      })
      .where(eq(orders.user_uuid, user.uuid));

    await tx
      .update(credits)
      .set({ user_uuid: erased, metadata_json: null })
      .where(eq(credits.user_uuid, user.uuid));
    await tx
      .update(credits)
      .set({ actor: erasedActor, metadata_json: null })
      .where(eq(credits.actor, `user:${user.uuid}`));

    await tx
      .delete(affiliates)
      .where(
        and(
          eq(affiliates.user_uuid, user.uuid),
          eq(affiliates.paid_order_no, ""),
        ),
      );
    await tx
      .update(affiliates)
      .set({ user_uuid: erased })
      .where(eq(affiliates.user_uuid, user.uuid));
    await tx
      .update(affiliates)
      .set({ invited_by: erased })
      .where(eq(affiliates.invited_by, user.uuid));
    await tx.execute(sql`
      update ${affiliateDeduplicationArchive}
      set "original_row_json" = (
        ${affiliateDeduplicationArchive.original_row_json}::jsonb
        || case
          when ${affiliateDeduplicationArchive.original_row_json}::jsonb ->> 'user_uuid' = ${user.uuid}
            then jsonb_build_object('user_uuid', ${erased}::text)
          else '{}'::jsonb
        end
        || case
          when ${affiliateDeduplicationArchive.original_row_json}::jsonb ->> 'invited_by' = ${user.uuid}
            then jsonb_build_object('invited_by', ${erased}::text)
          else '{}'::jsonb
        end
      )::text
      where ${affiliateDeduplicationArchive.original_row_json}::jsonb ->> 'user_uuid' = ${user.uuid}
         or ${affiliateDeduplicationArchive.original_row_json}::jsonb ->> 'invited_by' = ${user.uuid}
    `);

    await tx.delete(feedbacks).where(eq(feedbacks.user_uuid, user.uuid));
    await tx
      .update(reservations)
      .set({
        user_uuid: erased,
        contact_email: null,
        contact_phone: null,
        notes: null,
      })
      .where(eq(reservations.user_uuid, user.uuid));

    if (teardownOrgUuids.length > 0) {
      await tx
        .update(files)
        .set({
          user_uuid: erased,
          original_filename: "",
          metadata_json: null,
          updated_at: now,
        })
        .where(inArray(files.org_uuid, teardownOrgUuids));
      await tx.delete(tasks).where(inArray(tasks.org_uuid, teardownOrgUuids));
      await tx
        .update(subscriptions)
        .set({
          user_uuid: erased,
          status: "canceled",
          cancel_at_period_end: false,
          ended_at: now,
          note: null,
          updated_at: now,
        })
        .where(inArray(subscriptions.org_uuid, teardownOrgUuids));
    }

    await tx
      .update(files)
      .set({ user_uuid: erased, updated_at: now })
      .where(eq(files.user_uuid, user.uuid));
    await tx
      .update(tasks)
      .set({ user_uuid: erased, updated_at: now })
      .where(eq(tasks.user_uuid, user.uuid));
    await tx
      .update(subscriptions)
      .set({ user_uuid: erased, note: null, updated_at: now })
      .where(eq(subscriptions.user_uuid, user.uuid));

    await tx
      .update(authEvents)
      .set({
        user_uuid: erased,
        user_id: erased,
        email: "",
        ip_address: null,
        user_agent: null,
        metadata_json: null,
      })
      .where(
        or(
          eq(authEvents.user_uuid, user.uuid),
          eq(authEvents.user_id, user.id),
        ),
      );

    if (!input.retainSecurityBlocklistEntries) {
      await tx
        .delete(emailBlocklist)
        .where(sql`lower(${emailBlocklist.value}) = lower(${user.email})`);
    }

    await tx
      .update(adminAuditLogs)
      .set({
        actor_uuid: erased,
        actor_email: "",
        note: null,
        metadata_json: null,
        error_message: null,
        ip_address: null,
        user_agent: null,
      })
      .where(eq(adminAuditLogs.actor_uuid, user.uuid));
    await tx
      .update(adminAuditLogs)
      .set({
        target_uuid: erased,
        note: null,
        metadata_json: null,
        error_message: null,
      })
      .where(eq(adminAuditLogs.target_uuid, user.uuid));

    const customerIds = [...requiredCustomerIds];
    if (customerIds.length > 0) {
      await tx
        .update(stripeWebhookEvents)
        .set({ payload: null })
        .where(inArray(stripeWebhookEvents.stripe_customer_id, customerIds));
    }
    await tx
      .update(stripeWebhookEvents)
      .set({ resolved_by: erased, resolution_note: null })
      .where(eq(stripeWebhookEvents.resolved_by, user.uuid));

    await tx
      .update(jobs)
      .set({
        status: sql`
          case
            when ${jobs.dedupe_key} = ${`account_erasure:${request.uuid}`}
              then ${jobs.status}
            when ${jobs.status} in ('pending', 'running')
              then 'canceled'
            else ${jobs.status}
          end
        `,
        payload_json: null,
        dedupe_key: sql`${`erased-job:`} || ${jobs.uuid}`,
        subject_user_uuid: erased,
        last_error: null,
        updated_at: now,
        completed_at: sql`
          case
            when ${jobs.dedupe_key} <> ${`account_erasure:${request.uuid}`}
              and ${jobs.status} in ('pending', 'running')
              then ${nowIso}::timestamptz
            else ${jobs.completed_at}
          end
        `,
      })
      .where(
        or(
          eq(jobs.subject_user_uuid, user.uuid),
          // Compatibility for jobs queued before subject columns existed, and
          // provider-originated email jobs that initially know only an address.
          sql`strpos(coalesce(${jobs.payload_json}, ''), ${JSON.stringify(user.uuid)}) > 0`,
          sql`strpos(coalesce(${jobs.payload_json}, ''), ${JSON.stringify(user.email)}) > 0`,
        ),
      );

    await tx
      .update(privacyRequests)
      .set({
        user_id: erased,
        user_uuid: erased,
        idempotency_key: sql`${"erased-request:"} || ${privacyRequests.uuid}`,
        request_fingerprint: "",
        erased_subject_uuid: null,
        status: sql`
          case
            when ${privacyRequests.uuid} = ${request.uuid} then 'completed'
            when ${privacyRequests.status} = 'completed'
              and ${privacyRequests.request_type} = 'erasure' then 'completed'
            else 'canceled'
          end
        `,
        completed_at: sql`
          case
            when ${privacyRequests.uuid} = ${request.uuid}
              then ${nowIso}::timestamptz
            else ${privacyRequests.completed_at}
          end
        `,
        canceled_at: sql`
          case
            when ${privacyRequests.uuid} <> ${request.uuid}
              and ${privacyRequests.status} <> 'completed'
              then ${nowIso}::timestamptz
            else ${privacyRequests.canceled_at}
          end
        `,
        blockers_json: null,
        external_state_json: null,
        last_error: null,
        export_bucket: null,
        export_key: null,
        export_size: null,
        export_sha256: null,
        export_expires_at: null,
        updated_at: now,
      })
      .where(eq(privacyRequests.user_uuid, user.uuid));

    await tx.delete(users).where(eq(users.id, user.id));
    return "completed";
  });
}
