/** Session inventory and latest export must remain owner scoped in real SQL. */
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { db } from "@/db";
import { jobs, privacyRequests, sessions, users } from "@/db/schema";
import { listActiveAccountSessions } from "@/models/session";
import { findLatestExportForUser } from "@/models/account-lifecycle";
import { describeDb, useCleanDatabase } from "./setup";
useCleanDatabase();
describeDb("account settings scope", () => {
  it("excludes expired and foreign sessions", async () => {
    const owner = randomUUID(), other = randomUUID();
    await db().insert(users).values([owner, other].map(id => ({ id, uuid: randomUUID(), email: `${id}@test.dev` })));
    const active = randomUUID();
    await db().insert(sessions).values([
      { id: active, user_id: owner, token: randomUUID(), expires_at: new Date(Date.now() + 60_000) },
      { id: randomUUID(), user_id: owner, token: randomUUID(), expires_at: new Date(Date.now() - 60_000) },
      { id: randomUUID(), user_id: other, token: randomUUID(), expires_at: new Date(Date.now() + 60_000) },
    ]);
    expect((await listActiveAccountSessions(owner)).map(row => row.id)).toEqual([active]);
  });
  it("joins only the latest owner's export with its durable job", async () => {
    const owner = randomUUID(), other = randomUUID();
    await db().insert(users).values([owner, other].map(id => ({ id, uuid: id, email: `${id}@test.dev` })));
    const exportUuid = randomUUID();
    await db().insert(privacyRequests).values([
      { uuid: exportUuid, user_id: owner, user_uuid: owner, request_type: "export", idempotency_key: randomUUID(), request_fingerprint: "a".repeat(64) },
      { uuid: randomUUID(), user_id: other, user_uuid: other, request_type: "export", idempotency_key: randomUUID(), request_fingerprint: "b".repeat(64) },
      { uuid: randomUUID(), user_id: owner, user_uuid: owner, request_type: "erasure", idempotency_key: randomUUID(), request_fingerprint: "c".repeat(64) },
    ]);
    await db().insert(jobs).values({ uuid: randomUUID(), type: "account_data_export", dedupe_key: `account_data_export:${exportUuid}`, payload_json: "{}", status: "failed" });
    const latest = await findLatestExportForUser(owner);
    expect(latest?.request.uuid).toBe(exportUuid);
    expect(latest?.jobStatus).toBe("failed");
    expect(await findLatestExportForUser(randomUUID())).toBeUndefined();
  });
});
