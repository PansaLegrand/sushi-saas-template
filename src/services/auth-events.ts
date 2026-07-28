import { insertAuthEvent, type AuthEventName } from "@/models/auth-event";
import { updateUserLastSignin } from "@/models/user";
import { logger } from "@/lib/logger/server";

/**
 * Shape of the context Better Auth passes to database hooks. Typed loosely
 * because the hook signature marks it optional and its internals are not part
 * of the public API.
 */
export interface AuthHookContext {
  path?: string;
  headers?: Headers;
  request?: Request;
}

export interface AuthRequestInfo {
  provider: string;
  ip: string | null;
  userAgent: string | null;
  path: string;
}

function getHeaders(ctx?: AuthHookContext | null): Headers | undefined {
  return ctx?.headers ?? ctx?.request?.headers;
}

function getIp(headers: Headers | undefined): string | null {
  if (!headers) return null;

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return headers.get("x-real-ip") || headers.get("cf-connecting-ip") || null;
}

/**
 * Derive the sign-in provider from the endpoint that triggered the hook.
 *
 * `/callback/google` and `/sign-in/social` carry the provider in the path;
 * everything else under email/password is "credential".
 */
export function getProviderFromPath(path: string | undefined): string {
  if (!path) return "";

  const callback = path.match(/\/callback\/([a-z0-9_-]+)/i);
  if (callback?.[1]) return callback[1].toLowerCase();

  const oauth = path.match(/\/oauth2\/callback\/([a-z0-9_-]+)/i);
  if (oauth?.[1]) return oauth[1].toLowerCase();

  if (path.includes("/sign-in/email") || path.includes("/sign-up/email")) {
    return "credential";
  }

  return "";
}

export function describeAuthRequest(
  ctx?: AuthHookContext | null
): AuthRequestInfo {
  const headers = getHeaders(ctx);
  const path = ctx?.path ?? "";

  return {
    provider: getProviderFromPath(path),
    ip: getIp(headers),
    userAgent: headers?.get("user-agent") ?? null,
    path,
  };
}

interface RecordAuthEventParams {
  event: AuthEventName;
  userUuid?: string;
  userId?: string;
  email?: string;
  info: AuthRequestInfo;
  metadata?: unknown;
}

/**
 * Append an auth event. Never throws: losing an analytics row must not fail a
 * sign-up or sign-in.
 */
export async function recordAuthEvent({
  event,
  userUuid,
  userId,
  email,
  info,
  metadata,
}: RecordAuthEventParams): Promise<void> {
  try {
    await insertAuthEvent({
      event,
      user_uuid: userUuid,
      user_id: userId,
      email,
      provider: info.provider,
      ip_address: info.ip,
      user_agent: info.userAgent,
      metadata,
    });
  } catch (e) {
    logger.error({ err: e, event }, "failed to record auth event");
  }
}

/**
 * Denormalized last-seen timestamp. Also never throws.
 */
export async function touchLastSignin(
  userUuid: string,
  when: Date = new Date()
): Promise<void> {
  try {
    await updateUserLastSignin(userUuid, when);
  } catch (e) {
    logger.error({ err: e, user_uuid: userUuid }, "failed to update last signin");
  }
}
