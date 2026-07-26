import { getAppEnv, isProductionRuntime } from "@/lib/env";
import { logger } from "@/lib/logger/server";

export type AuthEmailLinkKind = "password_reset" | "verification";

const LABELS: Record<AuthEmailLinkKind, string> = {
  password_reset: "Reset password",
  verification: "Verify email",
};

export function hasEmailProviderConfigured(): boolean {
  const env = getAppEnv();
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export function logDevAuthEmailLink(input: {
  kind: AuthEmailLinkKind;
  email: string;
  url: string;
  reason?: string;
}): boolean {
  if (isProductionRuntime()) return false;

  logger.info(
    {
      event: "auth.email.dev_link",
      kind: input.kind,
      email: input.email,
      url: input.url,
      reason: input.reason,
    },
    `[dev auth] ${LABELS[input.kind]} link for ${input.email}: ${input.url}`
  );

  return true;
}
