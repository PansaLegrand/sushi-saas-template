import {
  pgTable,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// Users table
export const users = pgTable(
  "users",
  {
    id: varchar({ length: 255 }).primaryKey(),
    uuid: varchar({ length: 255 }).notNull().unique(),
    email: varchar({ length: 255 }).notNull(),
    // Stripe customer linkage (optional)
    stripe_customer_id: varchar({ length: 255 }),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    nickname: varchar({ length: 255 }).notNull().default(""),
    avatar_url: varchar({ length: 255 }),
    locale: varchar({ length: 50 }),
    signin_type: varchar({ length: 50 }),
    signin_ip: varchar({ length: 255 }),
    signin_provider: varchar({ length: 50 }),
    signin_openid: varchar({ length: 255 }),
    invite_code: varchar({ length: 255 }).notNull().default(""),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    invited_by: varchar({ length: 255 }).notNull().default(""),
    is_affiliate: boolean().notNull().default(false),
    email_verified: boolean().notNull().default(false),
    // Better Auth two-factor plugin. Admin roles are required to enable this
    // before the admin console authorizes them.
    two_factor_enabled: boolean().notNull().default(false),
    // Role-based access control: "user" | "admin_ro" | "admin_rw"
    role: varchar({ length: 50 }).notNull().default("user"),
    // Denormalized from auth_events so "when was this user last active" does
    // not require scanning the event table.
    last_signin_at: timestamp({ withTimezone: true }),

    // Suspension. A timestamp rather than a boolean-plus-date pair, because two
    // columns can disagree and one cannot: null is "not banned", and the value
    // is when it happened. Re-banning an already-banned account keeps the
    // original — the first ban is the fact, later ones are noise.
    //
    // This blocks sign-in, not existence. The row, the ledger, and the uploads
    // all stay: a ban is an abuse control, and destroying the evidence is the
    // opposite of what it is for. Erasure is a separate, policy-driven path.
    banned_at: timestamp({ withTimezone: true }),
    ban_reason: varchar({ length: 500 }),
    /** `users.uuid` of the admin who banned. Empty for a system ban. */
    banned_by: varchar({ length: 255 }).notNull().default(""),

    // active | deletion_pending | erasing
    //
    // Account deletion is an asynchronous, multi-provider workflow. This flag
    // closes the race where memberships have been removed but an authenticated
    // request reaches `getOrgContext()` and repairs the personal organization
    // that the erasure worker is tearing down.
    lifecycle_status: varchar({ length: 32 }).notNull().default("active"),
    deletion_requested_at: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex("email_provider_unique_idx").on(
      table.email,
      table.signin_provider,
    ),
    // Partial: only banned rows are indexed, so the admin console's "who is
    // suspended" list stays cheap without paying for an index over every user.
    index("users_banned_at_idx")
      .on(table.banned_at)
      .where(sql`${table.banned_at} is not null`),
  ],
);

// Sessions table (Better Auth core)
export const sessions = pgTable(
  "sessions",
  {
    id: varchar({ length: 255 }).primaryKey(),
    user_id: varchar({ length: 255 }).notNull(),
    token: varchar({ length: 512 }).notNull(),
    expires_at: timestamp({ withTimezone: true }).notNull(),
    ip_address: varchar({ length: 255 }),
    user_agent: text(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Which org this session is currently acting in. Better Auth writes it via
    // `organization.setActive`. It is a *default*, not the authorization input:
    // routes resolve the org from the URL so two tabs on two orgs cannot fight
    // over one session value. See `getOrgContext()`.
    active_organization_id: varchar({ length: 255 }),
  },
  (table) => [
    uniqueIndex("sessions_token_unique_idx").on(table.token),
    index("sessions_user_id_idx").on(table.user_id),
  ],
);

// Accounts table (Better Auth core)
export const accounts = pgTable(
  "accounts",
  {
    id: varchar({ length: 255 }).primaryKey(),
    user_id: varchar({ length: 255 }).notNull(),
    account_id: varchar({ length: 255 }).notNull(),
    provider_id: varchar({ length: 255 }).notNull(),
    access_token: text(),
    refresh_token: text(),
    id_token: text(),
    scope: text(),
    password: text(),
    access_token_expires_at: timestamp({ withTimezone: true }),
    refresh_token_expires_at: timestamp({ withTimezone: true }),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_provider_account_unique_idx").on(
      table.provider_id,
      table.account_id,
    ),
    index("accounts_user_id_idx").on(table.user_id),
  ],
);

// Verifications table (Better Auth core)
export const verifications = pgTable(
  "verifications",
  {
    id: varchar({ length: 255 }).primaryKey(),
    identifier: varchar({ length: 255 }).notNull(),
    value: text().notNull(),
    expires_at: timestamp({ withTimezone: true }).notNull(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("verifications_identifier_value_unique_idx").on(
      table.identifier,
      table.value,
    ),
    index("verifications_expires_at_idx").on(table.expires_at),
  ],
);

// Two-factor secrets and backup codes (Better Auth `two-factor` plugin)
export const twoFactor = pgTable(
  "two_factor",
  {
    id: varchar({ length: 255 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    user_id: varchar({ length: 255 }).notNull(),
    secret: text().notNull(),
    backup_codes: text().notNull(),
  },
  (table) => [uniqueIndex("two_factor_user_id_unique_idx").on(table.user_id)],
);

// ---------------------------------------------------------------------------
// Tenancy (Better Auth `organization` plugin)
//
// Every user belongs to at least one organization: signup creates a personal
// org with a single owner. There is deliberately no "user-owned resource" path
// alongside the org-owned one — a solo account is a team of one. That is what
// keeps tenancy from doubling every query, every permission check, and every
// billing rule.
//
// These three tables are owned by the plugin; the field names below are mapped
// to its logical model in `src/lib/auth.ts`. Do not add app columns here without
// declaring them as `additionalFields` there, or the adapter will not see them.
// ---------------------------------------------------------------------------

export const organizations = pgTable(
  "organizations",
  {
    id: varchar({ length: 255 }).primaryKey(),
    // Dual id, same convention as `users`: `id` belongs to Better Auth, `uuid`
    // is what application tables reference. Never expose `id` in a URL or an
    // API payload.
    uuid: varchar({ length: 255 }).notNull().unique(),
    name: varchar({ length: 255 }).notNull(),
    slug: varchar({ length: 255 }).notNull().unique(),
    logo: varchar({ length: 255 }),
    metadata: text(),
    // Billing subject. Moved off `users` — a subscription belongs to the org,
    // not to whoever happened to click checkout.
    stripe_customer_id: varchar({ length: 255 }),
    // True for the org created automatically at signup. A personal org cannot
    // be deleted or left while it is the user's only one.
    is_personal: boolean().notNull().default(false),
    // active | deleting | deleted. Deleted organizations remain as sanitized
    // tombstones so retained orders and ledger rows do not point at an
    // unexplained tenant identifier.
    lifecycle_status: varchar({ length: 32 }).notNull().default("active"),
    deleted_at: timestamp({ withTimezone: true }),
    // Optional support/VIP exception to the plan's organization.members cap.
    // Null means "inherit the plan"; expiry lets a temporary exception fall
    // back automatically without a scheduled cleanup job.
    member_limit_override: integer(),
    member_limit_override_expires_at: timestamp({ withTimezone: true }),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("organizations_stripe_customer_idx").on(table.stripe_customer_id),
    check(
      "organizations_member_limit_override_positive",
      sql`${table.member_limit_override} is null or ${table.member_limit_override} >= 1`,
    ),
  ],
);

export const orgMembers = pgTable(
  "org_members",
  {
    id: varchar({ length: 255 }).primaryKey(),
    organization_id: varchar({ length: 255 }).notNull(),
    user_id: varchar({ length: 255 }).notNull(),
    // "owner" | "admin" | "member". Kept as a string rather than an enum so a
    // fourth role is a code change, not a migration.
    role: varchar({ length: 50 }).notNull().default("member"),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One membership per user per org. Without this, a double-accepted
    // invitation silently grants two rows and the higher role wins by accident.
    uniqueIndex("org_members_org_user_unique_idx").on(
      table.organization_id,
      table.user_id,
    ),
    index("org_members_user_id_idx").on(table.user_id),
  ],
);

export const orgInvitations = pgTable(
  "org_invitations",
  {
    id: varchar({ length: 255 }).primaryKey(),
    organization_id: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull(),
    role: varchar({ length: 50 }),
    // "pending" | "accepted" | "rejected" | "canceled"
    status: varchar({ length: 50 }).notNull().default("pending"),
    expires_at: timestamp({ withTimezone: true }).notNull(),
    inviter_id: varchar({ length: 255 }).notNull(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("org_invitations_org_id_idx").on(table.organization_id),
    // Invitations are looked up by the address that was invited, before that
    // address has an account.
    index("org_invitations_email_idx").on(table.email),
  ],
);

// Orders table
export const orders = pgTable(
  "orders",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    order_no: varchar({ length: 255 }).notNull().unique(),
    created_at: timestamp({ withTimezone: true }),
    user_uuid: varchar({ length: 255 }).notNull().default(""),
    user_email: varchar({ length: 255 }).notNull().default(""),
    amount: integer().notNull(),
    interval: varchar({ length: 50 }),
    expired_at: timestamp({ withTimezone: true }),
    status: varchar({ length: 50 }).notNull(),
    stripe_session_id: varchar({ length: 255 }),
    // Structured provider identifiers make one-time refunds and disputes
    // attributable without scanning or parsing receipt blobs.
    stripe_payment_intent_id: varchar({ length: 255 }),
    stripe_charge_id: varchar({ length: 255 }),
    credits: integer().notNull(),
    currency: varchar({ length: 50 }),
    sub_id: varchar({ length: 255 }),
    sub_interval_count: integer(),
    sub_cycle_anchor: integer(),
    sub_period_end: integer(),
    sub_period_start: integer(),
    sub_times: integer(),
    product_id: varchar({ length: 255 }),
    product_name: varchar({ length: 255 }),
    valid_months: integer(),
    // Minimal allowlisted checkout receipt. Never store the full Stripe request:
    // its metadata contains user identifiers and email.
    order_detail: text(),
    paid_at: timestamp({ withTimezone: true }),
    paid_email: varchar({ length: 255 }),
    // Minimal allowlisted payment receipt. Full Stripe objects carry billing
    // addresses and payment metadata that this ledger does not need.
    paid_detail: text(),
    // One browser purchase intent maps to one order. Nullable so code deployed
    // before this column exists can continue inserting orders during an
    // expand/contract rollout.
    checkout_intent_id: varchar({ length: 255 }),
    // Hash of the canonical offer, Stripe Price, currency, and locale. Reusing
    // a key with different terms is a conflict, never a request to mutate the
    // original financial record.
    checkout_fingerprint: varchar({ length: 64 }),
    // Snapshots needed to recreate the exact Stripe request if the process dies
    // after inserting the order but before saving the Checkout Session.
    stripe_price_id: varchar({ length: 255 }),
    checkout_locale: varchar({ length: 50 }),
    // Tenant scope, mandatory since migration 0015: a row with no organization is
    // unreachable by every scoped read. `user_uuid` stays as the actor — who
    // clicked checkout — which is a different question from who it belongs to.
    org_uuid: varchar({ length: 255 }).notNull(),
  },
  (table) => [
    index("orders_org_idx").on(table.org_uuid),
    // NULL intent ids remain distinct for legacy and renewal orders. New
    // checkout orders always carry a key, and this index is the concurrency
    // boundary that turns two requests into one order.
    uniqueIndex("orders_org_checkout_intent_unique_idx").on(
      table.org_uuid,
      table.checkout_intent_id,
    ),
    index("orders_stripe_payment_intent_idx").on(
      table.stripe_payment_intent_id,
    ),
    index("orders_stripe_charge_idx").on(table.stripe_charge_id),
  ],
);

// Stripe webhook event idempotency
export const stripeWebhookEvents = pgTable(
  "stripe_webhook_events",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    event_id: varchar({ length: 255 }).notNull().unique(),
    event_type: varchar({ length: 255 }).notNull(),
    // `processing` | `completed` | `failed` | `action_required` | `resolved`.
    //
    // `action_required` is not a failure: it is a permanent condition a human
    // has to resolve, such as a price missing from the plan catalog. `failed` is
    // retried automatically; `action_required` answers Stripe 200 to stop the
    // retries, and is reclaimable only by a deliberate replay. Written by
    // `src/models/stripe-webhook-event.ts`, with the reason in `last_error`.
    //
    // `resolved` is the human's terminal answer to one of those, recorded from
    // the admin console: the work was done outside this system — a refund
    // reversed by hand, a dispute accepted — and the row should stop being a
    // work order. Terminal like `completed`, and deliberately so: a later
    // redelivery from Stripe is acknowledged and *not* re-run, because undoing
    // a person's decision by resending a webhook is the wrong default.
    status: varchar({ length: 32 }).notNull().default("processing"),
    attempts: integer().notNull().default(1),
    payload: text(),
    last_error: text(),
    received_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processed_at: timestamp({ withTimezone: true }),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),

    // ---------------------------------------------------------- the receipt
    // Denormalized out of `payload` at write time by
    // `src/services/stripe/receipt.ts`. The payload above is still the record of
    // truth; these exist because `text` cannot answer "every event for this
    // subscription" without a full scan and a JSON parse per row — the question
    // you have during an incident, when this table is at its largest.
    //
    // All nullable: rows written before migration 0019 have none, and no single
    // event carries all of them (a dispute has no invoice, a renewal has no
    // request id).
    stripe_object_id: varchar({ length: 255 }),
    stripe_customer_id: varchar({ length: 255 }),
    stripe_invoice_id: varchar({ length: 255 }),
    stripe_subscription_id: varchar({ length: 255 }),
    // Whether Stripe considers this live money. The webhook already refuses a
    // non-live event in production; this is the record for the ones that
    // legitimately are test-mode.
    livemode: boolean(),
    // The stored payload is only interpretable against the version that rendered
    // it, so a payload without one is a payload you have to guess at.
    api_version: varchar({ length: 64 }),
    // The API call or dashboard action that caused the event. Null for events
    // Stripe raised on its own, which is most of them.
    request_id: varchar({ length: 255 }),

    // ------------------------------------------------- the human's resolution
    // Set only when an admin closes a parked event from the console. Kept on the
    // row rather than only in `admin_audit_logs` because the question "why is
    // this one closed" is asked while reading this table, and an answer that
    // lives in another table is one nobody goes and gets.
    resolved_at: timestamp({ withTimezone: true }),
    /** `users.uuid` of the admin who resolved it. */
    resolved_by: varchar({ length: 255 }),
    /** Required at the API. A resolution with no reason is a row nobody can audit. */
    resolution_note: text(),
  },
  (table) => [
    index("stripe_webhook_events_status_idx").on(table.status),
    index("stripe_webhook_events_type_idx").on(table.event_type),
    // Three indexes, one per "show me this entity's history" question that is
    // actually asked: a customer's events, an invoice's events (which is what
    // reconciliation walks), and a subscription's. `stripe_object_id` is
    // deliberately unindexed — nothing queries by it yet, and an index nothing
    // reads is write cost on every event Stripe delivers.
    index("stripe_webhook_events_customer_idx").on(table.stripe_customer_id),
    index("stripe_webhook_events_invoice_idx").on(table.stripe_invoice_id),
    index("stripe_webhook_events_subscription_idx").on(
      table.stripe_subscription_id,
    ),
  ],
);

// Credits table
export const credits = pgTable(
  "credits",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    trans_no: varchar({ length: 255 }).notNull().unique(),
    created_at: timestamp({ withTimezone: true }),
    // Which member spent or earned this. Kept deliberately alongside `org_uuid`,
    // because the balance is pooled at the org but per-member quotas and usage
    // reporting are impossible to build later if nobody recorded who.
    //
    // Not the same thing as `actor` below: this is the member the movement is
    // attributed *to*, which on an admin grant is the recipient, not the admin.
    user_uuid: varchar({ length: 255 }).notNull(),
    trans_type: varchar({ length: 50 }).notNull(),
    credits: integer().notNull(),
    order_no: varchar({ length: 255 }),
    expired_at: timestamp({ withTimezone: true }),
    // The balance keys on this, not on user_uuid.
    org_uuid: varchar({ length: 255 }).notNull(),

    // ------------------------------------------------------------------ audit
    // The three columns below make a ledger row answer "why does this org have
    // this balance" without a join and a guess. All three are nullable because
    // rows written before they existed have no honest value — see migration 0018,
    // which backfills nothing rather than inventing history.

    // The running total of every row for this org, this row included.
    //
    // Deliberately the total, NOT the spendable balance: credits expire without
    // writing a ledger row, so a spend-aware figure would drift from the sum by
    // design and a reconciliation script could not tell that apart from a real
    // inconsistency. The invariant a script checks is that consecutive rows
    // satisfy `prev.balance_after + row.credits = row.balance_after`.
    //
    // Only correct if computed under the same per-org lock that guards a spend,
    // which is why `src/models/credit.ts` owns every write and the insert type
    // refuses a caller-supplied value.
    balance_after: integer(),
    // Who caused this movement, namespaced: `stripe:webhook`, `admin:<uuid>`,
    // `user:<uuid>`, `system:<reason>`. Distinguishes a grant an admin issued
    // from one Stripe paid for — indistinguishable today, because `trans_type`
    // records what happened and nothing recorded who.
    actor: varchar({ length: 255 }),
    // Free-form JSON context: the task a spend paid for, the transaction a refund
    // reverses. Named `metadata_json` to match `files` and `tasks`; the roadmap
    // calls it `metadata`, and matching the two neighbouring tables won.
    metadata_json: text(),
  },
  (table) => [index("credits_org_idx").on(table.org_uuid)],
);

// Affiliates table
export const affiliates = pgTable(
  "affiliates",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    user_uuid: varchar({ length: 255 }).notNull(),
    created_at: timestamp({ withTimezone: true }),
    status: varchar({ length: 50 }).notNull().default(""),
    invited_by: varchar({ length: 255 }).notNull(),
    paid_order_no: varchar({ length: 255 }).notNull().default(""),
    paid_amount: integer().notNull().default(0),
    reward_percent: integer().notNull().default(0),
    reward_amount: integer().notNull().default(0),
  },
  (table) => [
    // Signup attribution rows deliberately carry an empty order number and may
    // repeat. A paid order, however, may mint exactly one reward even when two
    // Stripe deliveries race on separate instances.
    uniqueIndex("affiliates_paid_order_unique_idx")
      .on(table.paid_order_no)
      .where(sql`${table.paid_order_no} <> ''`),
    uniqueIndex("affiliates_signup_user_unique_idx")
      .on(table.user_uuid)
      .where(sql`${table.paid_order_no} = ''`),
  ],
);

/**
 * Evidence preserved when the affiliate uniqueness migrations remove a replay.
 *
 * This is intentionally separate from the active affiliate table: archived
 * rows must never participate in commission or attribution queries, but a
 * financial cleanup must not destroy the facts it removed. `original_row_json`
 * stores the complete row as JSON text exactly as it existed at migration
 * time. The original and canonical ids make each decision independently
 * traceable without introducing a foreign key to mutable application data.
 */
export const affiliateDeduplicationArchive = pgTable(
  "affiliate_deduplication_archive",
  {
    archive_id: integer().primaryKey().generatedAlwaysAsIdentity(),
    original_affiliate_id: integer().notNull(),
    canonical_affiliate_id: integer().notNull(),
    reason: varchar({ length: 100 }).notNull(),
    original_row_json: text().notNull(),
    archived_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("affiliate_dedup_archive_original_reason_unique_idx").on(
      table.original_affiliate_id,
      table.reason,
    ),
  ],
);

// Feedbacks table
export const feedbacks = pgTable("feedbacks", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  created_at: timestamp({ withTimezone: true }),
  status: varchar({ length: 50 }),
  user_uuid: varchar({ length: 255 }),
  content: text(),
  rating: integer(),
});

// Reservation Services (demo feature)
export const reservationServices = pgTable(
  "reservation_services",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    slug: varchar({ length: 255 }).notNull().unique(),
    title: varchar({ length: 255 }).notNull(),
    description: text(),
    duration_min: integer().notNull().default(30),
    price: integer().notNull().default(0), // cents
    currency: varchar({ length: 10 }).notNull().default("usd"),
    deposit_amount: integer().notNull().default(0), // cents
    require_deposit: boolean().notNull().default(true),
    cancellation_window_hours: integer().notNull().default(24),
    buffer_before_min: integer().notNull().default(0),
    buffer_after_min: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("reservation_services_active_idx").on(table.active)],
);

// Reservations (demo feature)
export const reservations = pgTable(
  "reservations",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    reservation_no: varchar({ length: 255 }).notNull().unique(),
    user_uuid: varchar({ length: 255 }).notNull(),
    service_id: integer().notNull(),
    start_at: timestamp({ withTimezone: true }).notNull(),
    end_at: timestamp({ withTimezone: true }).notNull(),
    // The occupied range includes the service's before/after buffers. Keeping
    // the snapshot on the booking lets PostgreSQL enforce the time that was
    // sold even if an operator later changes the service configuration.
    blocked_start_at: timestamp({ withTimezone: true }).notNull(),
    blocked_end_at: timestamp({ withTimezone: true }).notNull(),
    timezone: varchar({ length: 64 }).notNull(),
    status: varchar({ length: 32 }).notNull().default("pending"), // pending|confirmed|canceled|expired
    hold_expires_at: timestamp({ withTimezone: true }),
    order_no: varchar({ length: 255 }),
    // One browser action owns one reservation. Nullable for rows created before
    // checkout-intent support; every new browser booking supplies a UUID.
    checkout_intent_id: varchar({ length: 255 }),
    // Hash of every reservation and payment term. The same key with different
    // input is rejected instead of mutating the already-claimed booking.
    checkout_fingerprint: varchar({ length: 64 }),
    contact_email: varchar({ length: 255 }),
    contact_phone: varchar({ length: 64 }),
    notes: text(),
    policy_snapshot: text(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    org_uuid: varchar({ length: 255 }).notNull(),
  },
  (table) => [
    index("reservations_service_time_idx").on(table.service_id, table.start_at),
    index("reservations_user_idx").on(table.user_uuid),
    index("reservations_org_idx").on(table.org_uuid),
    uniqueIndex("reservations_actor_checkout_intent_unique_idx").on(
      table.org_uuid,
      table.user_uuid,
      table.checkout_intent_id,
    ),
    uniqueIndex("reservations_order_no_unique_idx")
      .on(table.order_no)
      .where(sql`${table.order_no} is not null`),
    check(
      "reservations_time_order_check",
      sql`${table.end_at} > ${table.start_at}`,
    ),
    check(
      "reservations_blocked_time_order_check",
      sql`${table.blocked_end_at} > ${table.blocked_start_at}`,
    ),
    check(
      "reservations_status_check",
      sql`${table.status} in ('pending', 'confirmed', 'canceled', 'expired')`,
    ),
  ],
);

// Files (user uploads)
export const files = pgTable(
  "files",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    uuid: varchar({ length: 255 }).notNull().unique(),
    user_uuid: varchar({ length: 255 }).notNull(),
    // Optional future tenant/organization scoping
    org_id: varchar({ length: 255 }).notNull().default(""),

    // Storage location
    provider: varchar({ length: 32 }).notNull().default("s3"),
    bucket: varchar({ length: 255 }).notNull(),
    key: varchar({ length: 1024 }).notNull(),
    region: varchar({ length: 64 }),
    endpoint: varchar({ length: 255 }),
    version_id: varchar({ length: 255 }),

    // Object properties
    size: integer().notNull().default(0),
    content_type: varchar({ length: 255 })
      .notNull()
      .default("application/octet-stream"),
    etag: varchar({ length: 255 }),
    checksum_sha256: varchar({ length: 128 }),
    storage_class: varchar({ length: 64 }),

    // File metadata
    original_filename: varchar({ length: 255 }).notNull().default(""),
    extension: varchar({ length: 32 }).notNull().default(""),
    visibility: varchar({ length: 32 }).notNull().default("private"), // private|public|org
    status: varchar({ length: 32 }).notNull().default("uploading"), // uploading|active|deleting|deleted|failed
    metadata_json: text(),

    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deleted_at: timestamp({ withTimezone: true }),
    org_uuid: varchar({ length: 255 }).notNull(),
  },
  (table) => [
    index("files_user_idx").on(table.user_uuid),
    index("files_org_idx").on(table.org_uuid),
    uniqueIndex("files_bucket_key_unique_idx").on(table.bucket, table.key),
  ],
);

// Tasks (usage + AI actions)
export const tasks = pgTable(
  "tasks",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    uuid: varchar({ length: 255 }).notNull().unique(),
    user_uuid: varchar({ length: 255 }).notNull(),
    type: varchar({ length: 64 }).notNull().default("text_to_video"),
    status: varchar({ length: 32 }).notNull().default("queued"), // queued|running|succeeded|failed
    credits_used: integer().notNull().default(0),
    credits_trans_no: varchar({ length: 255 }),
    idempotency_key: varchar({ length: 255 }),

    user_input: text(),
    output_url: varchar({ length: 1024 }),
    output_json: text(),
    error_message: text(),

    started_at: timestamp({ withTimezone: true }),
    completed_at: timestamp({ withTimezone: true }),

    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    org_uuid: varchar({ length: 255 }).notNull(),
  },
  (table) => [
    index("tasks_user_idx").on(table.user_uuid),
    index("tasks_org_idx").on(table.org_uuid),
    index("tasks_status_idx").on(table.status),
    index("tasks_trans_idx").on(table.credits_trans_no),
    uniqueIndex("tasks_idempotency_unique_idx").on(
      table.user_uuid,
      table.type,
      table.idempotency_key,
    ),
  ],
);

// Auth events (append-only record of signups, sign-ins, and account lifecycle)
//
// Sessions are deleted on sign-out and expiry, so they cannot answer "how often
// does this user sign in". This table survives them.
export const authEvents = pgTable(
  "auth_events",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    uuid: varchar({ length: 255 }).notNull().unique(),

    // user_uuid is the app-facing id; user_id is Better Auth's own primary key.
    // Both are kept so events survive either lookup path.
    user_uuid: varchar({ length: 255 }).notNull().default(""),
    user_id: varchar({ length: 255 }).notNull().default(""),
    email: varchar({ length: 255 }).notNull().default(""),

    // signup | signin | email_verified
    event: varchar({ length: 32 }).notNull(),
    // credential | google | ...
    provider: varchar({ length: 50 }).notNull().default(""),

    ip_address: varchar({ length: 255 }),
    user_agent: varchar({ length: 1024 }),
    metadata_json: text(),

    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("auth_events_user_idx").on(table.user_uuid),
    index("auth_events_event_idx").on(table.event),
    index("auth_events_created_idx").on(table.created_at),
    index("auth_events_user_event_idx").on(table.user_uuid, table.event),
  ],
);

// ---------------------------------------------------------------------------
// Signup blocklist
//
// Why this is a table and not a flag on `users`: the unique index above is
// (email, signin_provider), so one address can hold several rows. Banning the
// account someone signed up with over a password does nothing to stop them
// coming back through Google on the same address — the second signup is a
// different row and sails past every check on the first.
//
// So the block has to live outside `users`, be keyed on the address rather than
// the account, and be matched in a normalized form. See
// `src/lib/email-address.ts` for what "normalized" means and what it costs.
// ---------------------------------------------------------------------------
export const emailBlocklist = pgTable(
  "email_blocklist",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    uuid: varchar({ length: 255 }).notNull().unique(),

    // "email" blocks one normalized address; "domain" blocks every address at
    // a host. During a signup flood the domain entry is the one that ends it —
    // one row for a disposable-mail provider beats four thousand address rows.
    scope: varchar({ length: 32 }).notNull().default("email"),

    /**
     * The match key: a normalized address for `scope = "email"`, a bare
     * lowercase host for `scope = "domain"`. Never compare against raw input —
     * go through `normalizeEmail()` / `normalizeEmailDomain()`, which is what
     * makes plus-aliases and dotted addresses collapse onto one row.
     */
    value: varchar({ length: 255 }).notNull(),

    /** What was actually typed. Kept so the trail shows the address as entered. */
    original_value: varchar({ length: 255 }).notNull().default(""),

    reason: varchar({ length: 500 }),
    /** `users.uuid` of the admin who added it. Empty for a system entry. */
    created_by: varchar({ length: 255 }).notNull().default(""),

    /** Null means permanent. A dated entry lets a flood block expire on its own. */
    expires_at: timestamp({ withTimezone: true }),

    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per rule. Re-blocking an address must be a no-op, not a second
    // row that has to be deleted twice before the block actually lifts.
    uniqueIndex("email_blocklist_scope_value_unique_idx").on(
      table.scope,
      table.value,
    ),
    index("email_blocklist_created_idx").on(table.created_at),
  ],
);

// Background jobs (durable queue drained by the Vercel cron endpoint)
//
// Work scheduled with queueMicrotask/setTimeout is not guaranteed to run on
// serverless: the instance can be frozen once the response is sent. Enqueueing
// a row instead makes the work survive that.
export const jobs = pgTable(
  "jobs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    uuid: varchar({ length: 255 }).notNull().unique(),

    type: varchar({ length: 64 }).notNull(),
    payload_json: text(),

    // pending | running | succeeded | failed
    status: varchar({ length: 32 }).notNull().default("pending"),
    attempts: integer().notNull().default(0),
    max_attempts: integer().notNull().default(5),

    // Earliest time this job may run. Also used for retry backoff.
    run_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Set while a runner holds the job; lets a stuck job be reclaimed.
    locked_at: timestamp({ withTimezone: true }),

    // Optional caller-supplied key that makes enqueueing idempotent.
    dedupe_key: varchar({ length: 255 }),
    // Privacy lifecycle operations need to cancel or scrub work by subject
    // without searching arbitrary JSON payload text.
    subject_user_uuid: varchar({ length: 255 }),
    subject_org_uuid: varchar({ length: 255 }),

    last_error: text(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completed_at: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("jobs_status_run_at_idx").on(table.status, table.run_at),
    index("jobs_type_idx").on(table.type),
    index("jobs_subject_user_idx").on(table.subject_user_uuid),
    index("jobs_subject_org_idx").on(table.subject_org_uuid),
    uniqueIndex("jobs_dedupe_key_unique_idx").on(table.dedupe_key),
  ],
);

// Account data export and erasure requests.
//
// External effects are intentionally not hidden in a Better Auth delete hook:
// Stripe and object storage cannot join a database transaction. A durable row
// records progress so the job runner can retry after a crash without pretending
// a provider deletion succeeded.
export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    uuid: varchar({ length: 255 }).notNull().unique(),
    request_type: varchar({ length: 32 }).notNull(), // export | erasure
    user_id: varchar({ length: 255 }).notNull(),
    user_uuid: varchar({ length: 255 }).notNull(),
    status: varchar({ length: 32 }).notNull().default("scheduled"),

    idempotency_key: varchar({ length: 255 }).notNull(),
    request_fingerprint: varchar({ length: 64 }).notNull(),
    erased_subject_uuid: varchar({ length: 255 }),

    scheduled_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    started_at: timestamp({ withTimezone: true }),
    completed_at: timestamp({ withTimezone: true }),
    canceled_at: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),

    blockers_json: text(),
    external_state_json: text(),
    last_error: text(),

    // Private export artifact. A route returns a short-lived signed URL; the
    // bucket/key never cross the API boundary.
    export_bucket: varchar({ length: 255 }),
    export_key: varchar({ length: 1024 }),
    export_size: integer(),
    export_sha256: varchar({ length: 64 }),
    export_expires_at: timestamp({ withTimezone: true }),

    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("privacy_requests_user_type_key_unique_idx").on(
      table.user_uuid,
      table.request_type,
      table.idempotency_key,
    ),
    uniqueIndex("privacy_requests_active_erasure_unique_idx")
      .on(table.user_uuid)
      .where(
        sql`${table.request_type} = 'erasure' and ${table.status} in ('scheduled', 'processing', 'failed')`,
      ),
    index("privacy_requests_user_created_idx").on(
      table.user_uuid,
      table.created_at,
    ),
    index("privacy_requests_due_idx").on(table.status, table.scheduled_at),
    check(
      "privacy_requests_type_check",
      sql`${table.request_type} in ('export', 'erasure')`,
    ),
    check(
      "privacy_requests_status_check",
      sql`${table.status} in ('scheduled', 'processing', 'blocked', 'completed', 'canceled', 'failed')`,
    ),
  ],
);

// Admin audit logs (append-only record of admin console actions)
export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    uuid: varchar({ length: 255 }).notNull().unique(),

    // Who acted. Email is denormalized so the trail survives user edits.
    actor_uuid: varchar({ length: 255 }).notNull(),
    actor_email: varchar({ length: 255 }).notNull().default(""),
    actor_role: varchar({ length: 50 }).notNull().default(""),

    // What happened, e.g. "credits.grant".
    action: varchar({ length: 64 }).notNull(),
    // What it happened to, e.g. "user" + the user uuid.
    target_type: varchar({ length: 64 }).notNull().default(""),
    target_uuid: varchar({ length: 255 }).notNull().default(""),

    status: varchar({ length: 32 }).notNull().default("succeeded"), // succeeded|failed
    note: text(),
    metadata_json: text(),
    error_message: text(),

    ip_address: varchar({ length: 255 }),
    user_agent: varchar({ length: 1024 }),

    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("admin_audit_logs_actor_idx").on(table.actor_uuid),
    index("admin_audit_logs_action_idx").on(table.action),
    index("admin_audit_logs_target_idx").on(
      table.target_type,
      table.target_uuid,
    ),
    index("admin_audit_logs_created_idx").on(table.created_at),
  ],
);

// Subscriptions: what a user is entitled to right now.
//
// This table and `orders` answer different questions and must not be merged.
// `orders` is the immutable financial log — what was paid, when, for what, and
// it is never rewritten after the fact. This table is the *current state* of
// the billing relationship, rewritten in place every time Stripe tells us it
// changed. Trying to answer "is this user on a paid plan" from `orders` means
// scanning for the newest row whose `expired_at` has not passed, which gets
// slower as the log grows and gets the answer wrong the moment someone cancels
// mid-period.
//
// One row per subscription, not per user: a user can hold a comped row and a
// paid row at once, and the entitlement service resolves them by plan rank.
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    uuid: varchar({ length: 255 }).notNull().unique(),

    user_uuid: varchar({ length: 255 }).notNull(),

    // Null for a comped subscription granted from the admin console. Postgres
    // allows many NULLs under a unique index, so manual rows do not collide.
    stripe_subscription_id: varchar({ length: 255 }),
    stripe_customer_id: varchar({ length: 255 }),
    stripe_price_id: varchar({ length: 255 }),

    // Resolved from the price at write time rather than at read time. Storing
    // it means a price ID later removed from the catalog does not silently
    // demote a paying customer — see docs/plans.md.
    tier: varchar({ length: 50 }).notNull(),

    // Stripe's own vocabulary: trialing | active | past_due | canceled |
    // incomplete | incomplete_expired | unpaid | paused. Kept verbatim so the
    // column can be compared against a Stripe dashboard without a mapping.
    status: varchar({ length: 32 }).notNull(),

    // stripe | manual. Manual rows are comped accounts, granted by an admin.
    source: varchar({ length: 32 }).notNull().default("stripe"),

    current_period_start: timestamp({ withTimezone: true }),
    current_period_end: timestamp({ withTimezone: true }),
    trial_end: timestamp({ withTimezone: true }),
    cancel_at_period_end: boolean().notNull().default(false),
    ended_at: timestamp({ withTimezone: true }),

    // When Stripe emitted the event this row was last written from.
    //
    // Webhooks arrive out of order. Without this, a `customer.subscription.
    // updated` delayed by a retry can land after the `deleted` that followed
    // it and resurrect a cancelled subscription. Every write compares against
    // this column and drops the older event.
    stripe_event_at: timestamp({ withTimezone: true }),

    // Why a manual subscription exists. Empty for Stripe rows.
    note: text(),

    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    org_uuid: varchar({ length: 255 }).notNull(),
  },
  (table) => [
    uniqueIndex("subscriptions_stripe_id_unique_idx").on(
      table.stripe_subscription_id,
    ),
    // The read path: "everything currently live for this user", on every
    // entitlement check.
    index("subscriptions_user_status_idx").on(table.user_uuid, table.status),
    // The same read path once the plan belongs to the org rather than to
    // whoever subscribed. Migration 0017 switches entitlement resolution to it.
    index("subscriptions_org_status_idx").on(table.org_uuid, table.status),
    index("subscriptions_customer_idx").on(table.stripe_customer_id),
  ],
);
