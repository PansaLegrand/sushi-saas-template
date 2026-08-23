export interface RestoreTargetInspection {
  ok: boolean;
  database: string | null;
  reasons: string[];
}

export function parsePostgresUrl(
  raw: string,
): { url: URL; database: string } | null;
export function inspectRestoreTarget(
  raw: string,
  confirmation: string | undefined,
): RestoreTargetInspection;
export function databaseConnectionParts(raw: string): {
  database: string;
  hostname: string;
  port: string;
  username: string;
  password: string;
  safeUrl: string;
};
export function safeBackupLabel(value: string): string;
