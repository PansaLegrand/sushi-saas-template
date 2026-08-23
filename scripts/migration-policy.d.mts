export const MIGRATION_POLICY_BASELINE_INDEX: number;
export interface MigrationPolicyFinding {
  file?: string;
  rule: string;
  message: string;
}
export function inspectMigrationSql(sql: string): MigrationPolicyFinding[];
export function inspectMigrationDirectory(
  migrationsDirectory: string,
): MigrationPolicyFinding[];
