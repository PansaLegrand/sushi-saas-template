export type AccountDataDisposition =
  | "delete"
  | "pseudonymize"
  | "retain"
  | "not-personal";

export type AccountDataPolicyEntry = {
  disposition: AccountDataDisposition;
  includedInExport: boolean;
  rationale: string;
};

/**
 * Inventory of every SQL table that can carry account data.
 *
 * `tests/unit/account-data-policy.test.ts` compares this map with
 * `src/db/schema.ts`, making a new table a deliberate privacy decision instead
 * of an invisible omission from export/erasure.
 */
export const ACCOUNT_DATA_POLICY = {
  users: {
    disposition: "delete",
    includedInExport: true,
    rationale: "Primary profile and sign-in provenance.",
  },
  sessions: {
    disposition: "delete",
    includedInExport: false,
    rationale: "Revoked credentials; tokens are never exported.",
  },
  accounts: {
    disposition: "delete",
    includedInExport: false,
    rationale: "Provider credentials and password hashes are never exported.",
  },
  verifications: {
    disposition: "delete",
    includedInExport: false,
    rationale: "Short-lived authentication secrets.",
  },
  two_factor: {
    disposition: "delete",
    includedInExport: false,
    rationale: "TOTP secrets and recovery codes are never exported.",
  },
  organizations: {
    disposition: "pseudonymize",
    includedInExport: true,
    rationale:
      "Solo workspaces become tombstones; shared workspaces remain owned by their other members.",
  },
  org_members: {
    disposition: "delete",
    includedInExport: true,
    rationale: "Memberships are removed when the account is erased.",
  },
  org_invitations: {
    disposition: "delete",
    includedInExport: true,
    rationale:
      "Received invitations are deleted and inviter attribution is scrubbed.",
  },
  orders: {
    disposition: "pseudonymize",
    includedInExport: true,
    rationale: "Financial records are retained without profile identifiers.",
  },
  stripe_webhook_events: {
    disposition: "pseudonymize",
    includedInExport: false,
    rationale:
      "Operational receipts are minimized; raw provider payloads are never exported.",
  },
  credits: {
    disposition: "pseudonymize",
    includedInExport: true,
    rationale: "Append-only financial/usage ledger must remain reconcilable.",
  },
  affiliates: {
    disposition: "pseudonymize",
    includedInExport: true,
    rationale:
      "Paid referral records are financial; unpaid attribution is removed.",
  },
  affiliate_deduplication_archive: {
    disposition: "pseudonymize",
    includedInExport: true,
    rationale:
      "Migration evidence is retained for financial reconciliation, with account identifiers replaced during erasure.",
  },
  feedbacks: {
    disposition: "delete",
    includedInExport: true,
    rationale: "User-authored feedback has no required financial retention.",
  },
  reservation_services: {
    disposition: "not-personal",
    includedInExport: false,
    rationale: "Product catalog, not account data.",
  },
  reservations: {
    disposition: "pseudonymize",
    includedInExport: true,
    rationale:
      "Operational booking history remains while contact fields are removed.",
  },
  files: {
    disposition: "pseudonymize",
    includedInExport: true,
    rationale:
      "Solo-workspace objects are deleted durably; shared-workspace ownership is pseudonymized.",
  },
  tasks: {
    disposition: "pseudonymize",
    includedInExport: true,
    rationale:
      "Solo-workspace outputs are deleted through the provider hook; shared work remains with the workspace.",
  },
  auth_events: {
    disposition: "pseudonymize",
    includedInExport: true,
    rationale:
      "Security history is retained without email, IP, device, or profile identifiers.",
  },
  email_blocklist: {
    disposition: "retain",
    includedInExport: false,
    rationale:
      "Optional abuse-prevention retention; controlled by account lifecycle policy.",
  },
  jobs: {
    disposition: "pseudonymize",
    includedInExport: false,
    rationale:
      "Pending work is canceled and its payload/error fields are scrubbed.",
  },
  privacy_requests: {
    disposition: "pseudonymize",
    includedInExport: true,
    rationale:
      "Lifecycle audit trail is retained without the live account identifier.",
  },
  admin_audit_logs: {
    disposition: "pseudonymize",
    includedInExport: true,
    rationale:
      "Security/audit evidence is retained with actor and target PII scrubbed.",
  },
  subscriptions: {
    disposition: "pseudonymize",
    includedInExport: true,
    rationale: "Billing history is retained without profile attribution.",
  },
} as const satisfies Record<string, AccountDataPolicyEntry>;

export type AccountDataTable = keyof typeof ACCOUNT_DATA_POLICY;
