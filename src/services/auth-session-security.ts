import { clearSessionMfaVerification, markSessionMfaVerified } from "@/models/session";
import { findUserById } from "@/models/user";

export async function invalidateSessionMfaVerification(userId: string): Promise<void> {
  await clearSessionMfaVerification(userId);
}

/** Called only by the successful second-factor SDK hook, never an HTTP input. */
export async function recordSessionMfaVerification(userId: string, sessionId: string): Promise<void> {
  const user = await findUserById(userId);
  if (!user?.two_factor_enabled) return;
  await markSessionMfaVerified(userId, sessionId);
}
