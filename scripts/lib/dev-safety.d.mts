export type SafetyResult = { ok: boolean; reasons: string[] };

export function isLoopbackHost(hostname: string): boolean;
export function inspectDevelopmentDatabaseUrl(
  raw: string,
  expectedDatabase: string,
): SafetyResult;
export function inspectDevelopmentRedisUrl(raw: string): SafetyResult;
export function inspectDevelopmentStorage(
  values: Record<string, string | undefined>,
): SafetyResult;
