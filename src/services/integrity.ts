import { listDataIntegrityFindings } from "@/models/integrity";

export async function checkDataIntegrity(now: Date = new Date()) {
  const checks = await listDataIntegrityFindings();
  const findings = checks.filter((check) => check.count > 0);
  return {
    checkedAt: now,
    healthy: findings.length === 0,
    checks: checks.length,
    findings,
  };
}
