# Backups, Restore Drills, and Retention

A backup is not proven until a different database can restore it and pass the
same migration check as the deployed application. This repository provides the
commands; the adopting team still chooses the managed-provider schedule, region,
encryption key, and legal retention policy.

## Recovery Targets

Set targets before launch and revise them when the product's tolerance changes:

- RPO: at most 24 hours of data loss for the default daily logical dump. Managed
  Postgres point-in-time recovery should normally reduce this to minutes.
- RTO: restore the database and pass migration verification within 60 minutes.
- Drill frequency: monthly, and before a database-provider migration.

Logical dumps complement provider snapshots. They do not replace point-in-time
recovery, cross-region copies, or object-storage versioning.

## Create a Verifiable Dump

```bash
pnpm db:backup
pnpm db:backup -- --output-dir /secure/backup/path --label production
```

`BACKUP_DATABASE_URL` takes precedence over `DATABASE_URL`, allowing a direct
read replica or non-pooled connection. The command:

- writes a PostgreSQL custom-format dump with owner and ACL metadata removed;
- never places the password in child-process arguments;
- creates files with mode `0600` under a mode `0700` directory;
- writes a SHA-256 manifest beside the dump;
- writes through an unpredictable `.partial` file and renames only on success;
- uses the bundled Postgres container when host `pg_dump` is unavailable.

The default `.data/backups` location is ignored by Git. Production automation
must copy completed dumps and manifests to encrypted, access-controlled storage
with lifecycle rules. Do not keep the only copy on the application host.

## Run a Guarded Restore Drill

Provision a disposable database whose name contains `restore`, `scratch`, or
`drill`. Local setup creates `sushi_restore_drill`.

```bash
export RESTORE_DATABASE_URL=postgresql://.../sushi_restore_drill
pnpm db:restore:drill -- --backup .data/backups/example.dump --confirm sushi_restore_drill
```

The command refuses `sushi_dev`, `sushi_test`, `sushi_content`, PostgreSQL
maintenance databases, names without an explicit scratch marker, or a
confirmation that does not exactly match the target database. It then:

1. verifies the dump's SHA-256 manifest;
2. replaces objects inside the confirmed scratch database with `pg_restore`;
3. runs `scripts/migrate.mjs --check` against the restored database;
4. confirms application tables exist;
5. writes an RTO report beside the dump.

The script never creates or drops a database. Database provisioning and final
scratch cleanup stay with the operator or managed provider, where access policy
and audit logging can apply.

## Operational Retention

The default policy is explicit and configurable:

| Dataset                             |  Default | Automatic            |
| ----------------------------------- | -------: | -------------------- |
| Finished background jobs            |  14 days | yes                  |
| Minimal marketing provider receipts |  30 days | yes                  |
| Authentication events               |  90 days | no; report/apply CLI |
| Admin audit logs                    | 365 days | no; report/apply CLI |

Override the defaults with `RETENTION_*_DAYS` only after reconciling the privacy
policy, abuse-investigation window, support needs, and applicable regulation.
Financial ledgers, orders, subscriptions, product records, and user-authored
content are intentionally unreachable from the generic retention service.

Preview before deleting:

```bash
pnpm retention:report
pnpm retention:apply -- --confirm your_database --production
```

The apply command requires the exact database name and prints counts per dataset.
It is idempotent: after a partial infrastructure failure, rerunning applies the
same cutoffs to whatever remains. Take and verify a backup before the first apply
or any major policy reduction.

HTTP cron and `pnpm jobs:work` share one maintenance service. Both prune the two
automatic datasets, detect stale uploads, and sweep parked Stripe webhooks. The
worker runs maintenance every `JOB_WORKER_MAINTENANCE_INTERVAL_MS` (five minutes
by default), so choosing the portable runner does not silently disable cleanup.
