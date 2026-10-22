/** Financial replay must remain testable without a database or a mocked allocator. */
import { describe, expect, it } from "vitest";
import { calculateCreditBalance, collapseCreditRowsToLogical, type CreditRow } from "@/models/credit";

const at = (day: number) => new Date(Date.UTC(2026, 0, day));
function row(id: number, amount: number, overrides: Partial<CreditRow> = {}): CreditRow {
  return { id, trans_no: `row-${id}`, user_uuid: "user", org_uuid: "org", credits: amount, trans_type: amount < 0 ? "task" : "grant", created_at: at(id), expired_at: null, order_no: "", actor: "user:user", balance_after: null, metadata_json: null, ...overrides };
}
function splitRows() {
  const ids = ["spend", "spend:part:2"];
  return ids.map((trans_no, index) => row(index + 3, -(index + 1) * 5, {
    trans_no, order_no: `order-${index}`, expired_at: at(10 + index), balance_after: 20 - index * 10,
    metadata_json: JSON.stringify({ reason: "example", __credit_fefo: { version: 1, root_trans_no: ids[0], part_trans_nos: ids, part_index: index, source_trans_nos: [`grant-${index}`] } }),
  }));
}
describe("pure ledger replay", () => {
  it("spends nearest expiry first, preserves later buckets, and ignores future facts", () => {
    const rows = [row(1, 10), row(2, 5, { expired_at: at(5) }), row(3, -7), row(9, 100)];
    const snapshot = calculateCreditBalance(rows, at(6));
    expect(snapshot.available).toBe(8);
    expect(snapshot.expired).toBe(0);
    expect(snapshot.allocationsByTransNo.get("row-3")).toEqual([
      { credits: 5, expiredAt: at(5), orderNo: "", sourceTransNos: ["row-2"] },
      { credits: 2, expiredAt: null, orderNo: "", sourceTransNos: ["row-1"] },
    ]);
    expect(rows[0].credits).toBe(10);
  });
  it("treats expiry as an instant, reports unused expiry, and carries legacy debt", () => {
    expect(calculateCreditBalance([row(1, 10, { expired_at: at(2) }), row(2, -3), row(3, 5)], at(4))).toMatchObject({ available: 2, expired: 10, activeGranted: 5, activeConsumed: 3 });
    expect(calculateCreditBalance([row(1, -10), row(2, 4)], at(3)).available).toBe(0);
    expect(calculateCreditBalance([], at(3)).available).toBe(0);
  });
  it("merges equal bucket terms and uses insertion identity to break timestamp ties", () => {
    const snapshot = calculateCreditBalance([row(2, 3, { created_at: at(1) }), row(1, 2), row(3, -4), row(4, -1)], at(5));
    expect(snapshot.allocationsByTransNo.get("row-3")?.[0]).toMatchObject({ credits: 4, sourceTransNos: ["row-1", "row-2"] });
    expect(snapshot.available).toBe(0);
  });
  it("projects complete split spends once without private metadata or false bucket terms", () => {
    const physical = splitRows();
    const logical = collapseCreditRowsToLogical([...physical].reverse());
    expect(logical).toHaveLength(1);
    expect(logical[0]).toMatchObject({ trans_no: "spend", credits: -15, order_no: null, expired_at: null, balance_after: 10, metadata_json: JSON.stringify({ reason: "example" }) });
    expect(physical[0].metadata_json).toContain("__credit_fefo");
    const matching = physical.map(part => ({ ...part, order_no: "same", expired_at: null }));
    expect(collapseCreditRowsToLogical(matching)[0]).toMatchObject({ order_no: "same", expired_at: null });
  });
  it.each(["org_uuid", "user_uuid", "actor", "trans_type", "credits"] as const)("refuses to group inconsistent %s", field => {
    const rows = splitRows();
    rows[1] = { ...rows[1], [field]: field === "credits" ? 10 : "foreign" };
    const projected = collapseCreditRowsToLogical(rows);
    expect(projected).toHaveLength(2);
    expect(JSON.stringify(projected)).not.toContain("__credit_fefo");
  });
  it("retains incomplete and malformed evidence without trusting its grouping metadata", () => {
    expect(collapseCreditRowsToLogical(splitRows().slice(1))).toHaveLength(1);
    expect(collapseCreditRowsToLogical(splitRows().slice(0, 1))).toHaveLength(1);
    for (const metadata_json of [null, "broken json", "[]", JSON.stringify({ __credit_fefo: { version: 99 } }), JSON.stringify({ __credit_fefo: null })]) {
      const result = collapseCreditRowsToLogical([row(1, 5, { metadata_json })]);
      expect(result[0].credits).toBe(5);
      expect(result[0].metadata_json ?? "").not.toContain("__credit_fefo");
    }
  });
});
