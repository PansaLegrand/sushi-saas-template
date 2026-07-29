import { createHash, randomUUID } from "node:crypto";

import { ACCOUNT_LIFECYCLE_POLICY } from "@/config/account-lifecycle";
import { auth } from "@/lib/auth";
import { AppError, isAppError } from "@/lib/errors";
import {
  beginPrivacyRequest,
  cancelScheduledErasure,
  clearExpiredAccountExportArtifact,
  completeAccountExport,
  createPrivacyRequest,
  finalizeAccountErasure,
  findLatestErasureForUser,
  findPrivacyRequestByUuid,
  findPrivacyRequestForUser,
  getAccountErasurePlan,
  getAccountExportData,
  markPrivacyRequestFailed,
  parsePrivacyExternalState,
  prepareAccountExportArtifact,
  recordPrivacyExternalEffect,
  type LifecycleBlocker,
  type PrivacyExternalEffect,
  type PrivacyRequestRow,
} from "@/models/account-lifecycle";
import { findUserById } from "@/models/user";
import { deleteStoredObject } from "@/services/storage/delete-worker";
import { getStorageAdapter } from "@/services/storage";
import {
  cancelStripeCustomerSubscriptionsForErasure,
  cancelStripeSubscriptionForErasure,
  deleteStripeCustomerForErasure,
} from "@/services/stripe/account-erasure";

import { deleteTaskOutputForErasure } from "./external-data";

export type AccountActor = {
  userId: string;
  userUuid: string;
  email: string;
  lifecycleStatus: string;
  sessionCreatedAt: Date;
};

export type PublicPrivacyRequest = {
  uuid: string;
  type: string;
  status: string;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  blockers?: LifecycleBlocker[];
};

export type AccountExportStatus = PublicPrivacyRequest & {
  expiresAt?: string;
  sha256?: string;
  size?: number;
  download?: {
    manifest: { url: string; expiresIn: number };
    files: Array<{
      uuid: string;
      filename: string;
      url: string;
      expiresIn: number;
    }>;
  };
};

function dateOf(value: Date | string | null | undefined): Date {
  if (value instanceof Date) return value;
  const parsed = value ? new Date(value) : new Date(0);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function requestBlockers(request: PrivacyRequestRow): LifecycleBlocker[] {
  if (!request.blockers_json) return [];
  try {
    const parsed = JSON.parse(request.blockers_json);
    return Array.isArray(parsed) ? (parsed as LifecycleBlocker[]) : [];
  } catch {
    return [];
  }
}

function toPublicRequest(request: PrivacyRequestRow): PublicPrivacyRequest {
  const blockers = requestBlockers(request);
  return {
    uuid: request.uuid,
    type: request.request_type,
    status: request.status,
    scheduledAt: request.scheduled_at.toISOString(),
    startedAt: request.started_at?.toISOString() ?? null,
    completedAt: request.completed_at?.toISOString() ?? null,
    canceledAt: request.canceled_at?.toISOString() ?? null,
    createdAt: request.created_at.toISOString(),
    ...(blockers.length > 0 ? { blockers } : {}),
  };
}

function fingerprint(kind: "export" | "erasure", userUuid: string): string {
  return createHash("sha256")
    .update(`account-lifecycle:v1:${kind}:${userUuid}`)
    .digest("hex");
}

export function validateAccountLifecycleIdempotencyKey(raw: string | null): string {
  const key = raw?.trim();
  if (!key) {
    throw new AppError("REQUEST_MISSING_FIELD", {
      message: "Idempotency-Key header is required",
      details: { fields: [{ field: "Idempotency-Key", code: "required" }] },
    });
  }
  if (key.length > 255 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new AppError("REQUEST_VALIDATION_FAILED", {
      message: "Idempotency-Key must be at most 255 printable characters",
      details: {
        fields: [{ field: "Idempotency-Key", code: "invalid_string" }],
      },
    });
  }
  return key;
}

/** Authenticate an account route without resolving or repairing a workspace. */
export async function getAccountActorFromHeaders(
  headers: Headers,
): Promise<AccountActor | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) return null;

  const user = await findUserById(session.user.id);
  if (!user) return null;

  return {
    userId: user.id,
    userUuid: user.uuid,
    email: user.email,
    lifecycleStatus: user.lifecycle_status,
    sessionCreatedAt: dateOf(
      (session.session as { createdAt?: Date | string }).createdAt,
    ),
  };
}

export function requireFreshAccountSession(actor: AccountActor): void {
  if (
    Date.now() - actor.sessionCreatedAt.getTime() >
    ACCOUNT_LIFECYCLE_POLICY.sensitiveSessionMaxAgeMs
  ) {
    throw new AppError("AUTH_REAUTHENTICATION_REQUIRED", {
      message: "account erasure requested with a stale session",
    });
  }
}

function throwForBlockers(blockers: LifecycleBlocker[]): never {
  const owner = blockers.find(
    (blocker): blocker is Extract<LifecycleBlocker, { kind: "owner_transfer" }> =>
      blocker.kind === "owner_transfer",
  );
  if (owner) {
    throw new AppError("ACCOUNT_DELETION_OWNER_TRANSFER_REQUIRED", {
      message: "account owns shared organizations",
      details: { organizations: owner.organizations },
    });
  }

  throw new AppError("ACCOUNT_DELETION_ADMIN_CONTINUITY_REQUIRED", {
    message: "account is the last full-access administrator",
  });
}

export async function requestAccountDataExport(input: {
  actor: AccountActor;
  idempotencyKey: string;
}): Promise<PublicPrivacyRequest> {
  if (input.actor.lifecycleStatus === "erasing") {
    throw new AppError("ACCOUNT_DELETION_IN_PROGRESS");
  }

  const requestUuid = randomUUID();
  const result = await createPrivacyRequest({
    uuid: requestUuid,
    requestType: "export",
    userId: input.actor.userId,
    userUuid: input.actor.userUuid,
    idempotencyKey: input.idempotencyKey,
    fingerprint: fingerprint("export", input.actor.userUuid),
    scheduledAt: new Date(),
    erasedSubjectUuid: `erased-${randomUUID()}`,
    jobUuid: randomUUID(),
    maxAttempts: 8,
  });

  if (result.outcome === "conflict") {
    throw new AppError("ACCOUNT_LIFECYCLE_CONFLICT");
  }
  if (result.outcome === "account_erasing") {
    throw new AppError("ACCOUNT_DELETION_IN_PROGRESS");
  }
  if (result.outcome === "not_found") {
    throw new AppError("ACCOUNT_NOT_FOUND");
  }
  if (result.outcome === "blocked") {
    throwForBlockers(result.blockers);
  }

  return toPublicRequest(result.request);
}

export async function requestAccountErasure(input: {
  actor: AccountActor;
  idempotencyKey: string;
}): Promise<PublicPrivacyRequest> {
  requireFreshAccountSession(input.actor);
  if (input.actor.lifecycleStatus === "erasing") {
    throw new AppError("ACCOUNT_DELETION_IN_PROGRESS");
  }

  const requestUuid = randomUUID();
  const scheduledAt = new Date(
    Date.now() + ACCOUNT_LIFECYCLE_POLICY.erasureGracePeriodMs,
  );
  const result = await createPrivacyRequest({
    uuid: requestUuid,
    requestType: "erasure",
    userId: input.actor.userId,
    userUuid: input.actor.userUuid,
    idempotencyKey: input.idempotencyKey,
    fingerprint: fingerprint("erasure", input.actor.userUuid),
    scheduledAt,
    erasedSubjectUuid: `erased-${randomUUID()}`,
    jobUuid: randomUUID(),
    maxAttempts: 20,
  });

  if (result.outcome === "conflict") {
    throw new AppError("ACCOUNT_LIFECYCLE_CONFLICT");
  }
  if (result.outcome === "account_erasing") {
    throw new AppError("ACCOUNT_DELETION_IN_PROGRESS");
  }
  if (result.outcome === "not_found") {
    throw new AppError("ACCOUNT_NOT_FOUND");
  }
  if (result.outcome === "blocked") {
    throwForBlockers(result.blockers);
  }

  if (result.request.status === "blocked") {
    throwForBlockers(requestBlockers(result.request));
  }
  return toPublicRequest(result.request);
}

export async function getAccountErasureStatus(
  actor: AccountActor,
): Promise<PublicPrivacyRequest | null> {
  const request = await findLatestErasureForUser(actor.userUuid);
  return request ? toPublicRequest(request) : null;
}

export async function cancelAccountErasure(
  actor: AccountActor,
): Promise<{ canceled: boolean }> {
  const outcome = await cancelScheduledErasure({
    userId: actor.userId,
    userUuid: actor.userUuid,
  });
  if (outcome === "cannot_cancel") {
    throw new AppError("ACCOUNT_DELETION_CANNOT_CANCEL");
  }
  return { canceled: outcome === "canceled" };
}

export async function getAccountExportStatus(input: {
  actor: AccountActor;
  requestUuid: string;
}): Promise<AccountExportStatus> {
  const request = await findPrivacyRequestForUser({
    uuid: input.requestUuid,
    userUuid: input.actor.userUuid,
    requestType: "export",
  });
  if (!request) throw new AppError("RESOURCE_NOT_FOUND");

  const base: AccountExportStatus = {
    ...toPublicRequest(request),
    ...(request.export_expires_at
      ? { expiresAt: request.export_expires_at.toISOString() }
      : {}),
    ...(request.export_sha256 ? { sha256: request.export_sha256 } : {}),
    ...(request.export_size != null ? { size: request.export_size } : {}),
  };

  if (request.status === "failed") {
    throw new AppError("ACCOUNT_EXPORT_FAILED", {
      message: request.last_error ?? "account export job failed",
    });
  }
  if (request.status !== "completed") return base;
  if (
    !request.export_expires_at ||
    request.export_expires_at.getTime() <= Date.now() ||
    !request.export_bucket ||
    !request.export_key
  ) {
    throw new AppError("ACCOUNT_EXPORT_EXPIRED");
  }

  const storage = getStorageAdapter();
  const manifest = await storage.getPresignedDownload({
    bucket: request.export_bucket,
    key: request.export_key,
    filename: `account-data-${request.uuid}.json`,
    responseContentType: "application/json",
    expiresIn: ACCOUNT_LIFECYCLE_POLICY.exportDownloadUrlSeconds,
  });

  // File contents stay in their original private objects. Sign them only at
  // this authenticated boundary so neither the manifest nor the database ever
  // contains a durable bearer URL.
  const exportData = await getAccountExportData({
    userId: input.actor.userId,
    userUuid: input.actor.userUuid,
  });
  const fileDownloads: NonNullable<
    AccountExportStatus["download"]
  >["files"] = [];
  for (const file of exportData?.fileObjects ?? []) {
    if (file.status !== "active") continue;
    const signed = await storage.getPresignedDownload({
      bucket: file.bucket,
      key: file.key,
      filename: file.filename.replaceAll('"', ""),
      responseContentType: file.contentType,
      expiresIn: ACCOUNT_LIFECYCLE_POLICY.exportDownloadUrlSeconds,
    });
    fileDownloads.push({
      uuid: file.uuid,
      filename: file.filename,
      url: signed.url,
      expiresIn: signed.expiresIn,
    });
  }

  return {
    ...base,
    download: { manifest, files: fileDownloads },
  };
}

function asWorkerError(code: "ACCOUNT_EXPORT_FAILED" | "ACCOUNT_LIFECYCLE_FAILED", cause: unknown) {
  if (isAppError(cause)) return cause;
  return new AppError(code, {
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

export async function runAccountDataExport(input: {
  requestUuid: string;
}): Promise<void> {
  const begun = await beginPrivacyRequest(input.requestUuid, "export");
  if (begun.outcome === "terminal" || begun.outcome === "not_due") return;
  if (begun.outcome !== "started") {
    throw new AppError("ACCOUNT_EXPORT_FAILED", {
      message: `account export could not start: ${begun.outcome}`,
    });
  }

  const storage = getStorageAdapter();
  const bucket = storage.getDefaultBucket();
  const key = `account-exports/${begun.request.uuid}/account-data.json`;

  try {
    const data = await getAccountExportData({
      userId: begun.user.id,
      userUuid: begun.user.uuid,
    });
    if (!data) throw new AppError("ACCOUNT_NOT_FOUND");

    const document = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      note:
        "Authentication secrets, password hashes, access tokens, webhook payloads, and private storage coordinates are intentionally excluded.",
      data: data.snapshot,
    };
    const body = new TextEncoder().encode(JSON.stringify(document, null, 2));
    const sha256 = createHash("sha256").update(body).digest("hex");
    const expiresAt = new Date(
      Date.now() + ACCOUNT_LIFECYCLE_POLICY.exportRetentionMs,
    );
    const cleanupJobUuid = randomUUID();

    const prepared = await prepareAccountExportArtifact({
      requestUuid: begun.request.uuid,
      bucket,
      key,
      expiresAt,
      cleanupJobUuid,
    });
    if (!prepared) return;

    await storage.putObject({
      bucket,
      key,
      body,
      contentType: "application/json",
      metadata: {
        lifecycle: "account-export",
        request: begun.request.uuid,
      },
    });

    const completed = await completeAccountExport({
      requestUuid: begun.request.uuid,
      bucket,
      key,
      size: body.byteLength,
      sha256,
      expiresAt,
      cleanupJobUuid,
    });
    if (!completed) {
      // Erasure may have crossed its irreversible boundary while the export was
      // uploading. Do not leave an untracked artifact behind.
      await storage.deleteObject({ bucket, key });
    }
  } catch (cause) {
    await markPrivacyRequestFailed(input.requestUuid, String(cause));
    throw asWorkerError("ACCOUNT_EXPORT_FAILED", cause);
  }
}

async function rememberEffect(
  requestUuid: string,
  effect: PrivacyExternalEffect,
  id: string,
  state: ReturnType<typeof parsePrivacyExternalState>,
) {
  if (state[effect].includes(id)) return;
  await recordPrivacyExternalEffect({ requestUuid, effect, id });
  state[effect].push(id);
}

export async function runAccountErasure(input: {
  requestUuid: string;
}): Promise<void> {
  const begun = await beginPrivacyRequest(input.requestUuid, "erasure");
  if (
    begun.outcome === "terminal" ||
    begun.outcome === "not_due" ||
    begun.outcome === "blocked"
  ) {
    return;
  }
  if (begun.outcome !== "started") {
    throw new AppError("ACCOUNT_LIFECYCLE_FAILED", {
      message: `account erasure could not start: ${begun.outcome}`,
    });
  }

  try {
    const plan = await getAccountErasurePlan(input.requestUuid);
    if (!plan) {
      const current = await findPrivacyRequestByUuid(input.requestUuid);
      if (current?.status === "completed") return;
      throw new AppError("ACCOUNT_LIFECYCLE_FAILED", {
        message: "account erasure plan no longer resolves",
      });
    }
    if (plan.blockers.length > 0) throwForBlockers(plan.blockers);

    const state = parsePrivacyExternalState(
      plan.request.external_state_json,
    );

    // Cancel every locally known subscription, then ask Stripe for every
    // subscription on each customer. The second pass closes webhook lag.
    for (const subscription of plan.stripeSubscriptions) {
      const id = subscription.stripe_subscription_id;
      if (!id || state.stripeSubscriptions.includes(id)) continue;
      await cancelStripeSubscriptionForErasure({
        subscriptionId: id,
        requestUuid: input.requestUuid,
      });
      await rememberEffect(
        input.requestUuid,
        "stripeSubscriptions",
        id,
        state,
      );
    }

    for (const customerId of plan.stripeCustomerIds) {
      const discovered =
        await cancelStripeCustomerSubscriptionsForErasure({
          customerId,
          requestUuid: input.requestUuid,
        });
      for (const subscriptionId of discovered) {
        await rememberEffect(
          input.requestUuid,
          "stripeSubscriptions",
          subscriptionId,
          state,
        );
      }

      if (
        ACCOUNT_LIFECYCLE_POLICY.deleteStripeCustomers &&
        !state.stripeCustomers.includes(customerId)
      ) {
        await deleteStripeCustomerForErasure({
          customerId,
          requestUuid: input.requestUuid,
        });
        await rememberEffect(
          input.requestUuid,
          "stripeCustomers",
          customerId,
          state,
        );
      }
    }

    for (const file of plan.storedFiles) {
      if (state.storageFiles.includes(file.uuid)) continue;
      await deleteStoredObject({
        fileUuid: file.uuid,
        orgUuid: file.org_uuid,
      });
      await rememberEffect(
        input.requestUuid,
        "storageFiles",
        file.uuid,
        state,
      );
    }

    for (const task of plan.taskOutputs) {
      if (state.taskOutputs.includes(task.uuid)) continue;
      await deleteTaskOutputForErasure(task);
      await rememberEffect(
        input.requestUuid,
        "taskOutputs",
        task.uuid,
        state,
      );
    }

    const storage = getStorageAdapter();
    for (const artifact of plan.exportArtifacts) {
      const id = `${artifact.bucket}/${artifact.key}`;
      if (state.exportArtifacts.includes(id)) continue;
      await storage.deleteObject({
        bucket: artifact.bucket,
        key: artifact.key,
      });
      await rememberEffect(
        input.requestUuid,
        "exportArtifacts",
        id,
        state,
      );
    }

    const finalized = await finalizeAccountErasure({
      requestUuid: input.requestUuid,
      requireStripeCustomerDeletion:
        ACCOUNT_LIFECYCLE_POLICY.deleteStripeCustomers,
      retainSecurityBlocklistEntries:
        ACCOUNT_LIFECYCLE_POLICY.retainSecurityBlocklistEntries,
    });
    if (
      finalized !== "completed" &&
      finalized !== "already_completed"
    ) {
      throw new AppError("ACCOUNT_LIFECYCLE_FAILED", {
        message: `account erasure cannot finalize: ${finalized}`,
      });
    }
  } catch (cause) {
    await markPrivacyRequestFailed(input.requestUuid, String(cause));
    throw asWorkerError("ACCOUNT_LIFECYCLE_FAILED", cause);
  }
}

export async function expireAccountExport(input: {
  requestUuid: string;
}): Promise<void> {
  const request = await findPrivacyRequestByUuid(input.requestUuid);
  if (
    !request ||
    request.request_type !== "export" ||
    !request.export_bucket ||
    !request.export_key
  ) {
    return;
  }
  if (
    request.export_expires_at &&
    request.export_expires_at.getTime() > Date.now()
  ) {
    return;
  }

  const storage = getStorageAdapter();
  await storage.deleteObject({
    bucket: request.export_bucket,
    key: request.export_key,
  });
  await clearExpiredAccountExportArtifact(request.uuid);
}
