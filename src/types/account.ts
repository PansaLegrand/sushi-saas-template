export type AccountSessionView = {
  reference: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  userAgent: string | null;
};

export type AccountSettingsView = {
  userUuid: string;
  name: string;
  email: string;
  emailVerified: boolean;
  hasPassword: boolean;
  providers: string[];
  twoFactorEnabled: boolean;
  mfaRequired: boolean;
  sessions: AccountSessionView[];
};

export type SessionRevocation = { scope: "others" } | { scope: "session"; reference: string };
export type PrivacyBlocker = { kind: "owner_transfer"; organizations: { uuid: string; slug: string; name: string }[] } | { kind: "admin_continuity" };
export type PrivacyRequestView = {
  uuid: string; type: string; status: string; scheduledAt: string;
  startedAt: string | null; completedAt: string | null; canceledAt: string | null;
  createdAt: string; blockers?: PrivacyBlocker[];
};
export type AccountExportView = PrivacyRequestView & {
  expiresAt?: string; sha256?: string; size?: number;
  download?: { manifest: { url: string; expiresIn: number }; files: { uuid: string; filename: string; url: string; expiresIn: number }[] };
};
