/**
 * Database tier: the admin orders view.
 *
 * The column that earns this file is "did the credits land". It is a join
 * between two tables keyed on `order_no`, and the two failure modes it exists
 * to reveal — a paid order with no ledger row, and one with *two* — are both
 * shapes a mocked model would happily report as fine.
 *
 * The rest is the same list/count/filter contract the other admin lists have,
 * asserted here because a count computed from a different predicate than the
 * rows is a paginator that lies.
 */
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { credits, orders } from "@/db/schema";
import {
  countAdminOrders,
  countAdminOrdersByStatus,
  listAdminOrders,
} from "@admin/lib/data";
import { findCreditsByOrderNos } from "@/models/credit";
import { OrderStatus } from "@/models/order";

useCleanDatabase();

async function seedOrder(input: {
  order_no: string;
  status?: string;
  credits?: number;
  org_uuid?: string;
  user_uuid?: string;
  user_email?: string;
  sub_id?: string | null;
  created_at?: Date;
}) {
  await db()
    .insert(orders)
    .values({
      order_no: input.order_no,
      status: input.status ?? OrderStatus.Paid,
      org_uuid: input.org_uuid ?? "org-1",
      user_uuid: input.user_uuid ?? "user-1",
      user_email: input.user_email ?? "buyer@corp.example",
      amount: 2500,
      currency: "usd",
      credits: input.credits ?? 100,
      sub_id: input.sub_id ?? null,
      created_at: input.created_at ?? new Date(),
      paid_at: new Date(),
      // Blobs the console must never select. Populated so the allowlist
      // assertion below is testing something.
      order_detail: JSON.stringify({ secret: "raw provider payload" }),
      paid_detail: JSON.stringify({ secret: "raw provider payload" }),
    });
}

async function seedGrant(orderNo: string, amount = 100, transNo?: string) {
  await db()
    .insert(credits)
    .values({
      trans_no: transNo ?? `order_pay:${orderNo}:${randomUUID()}`,
      created_at: new Date(),
      org_uuid: "org-1",
      user_uuid: "user-1",
      trans_type: "order_pay",
      credits: amount,
      order_no: orderNo,
    });
}

describeDb("admin orders list", () => {
  it("finds an order by its number, whichever shape it is", async () => {
    // Three formats coexist: a renewal key, a UUIDv7, and old numeric ids. An
    // operator arrives with whichever one their ticket quoted.
    await seedOrder({ order_no: "renewal:sub_abc:1767225600" });
    await seedOrder({ order_no: "0192f3a1-7000-7000-8000-abcdefabcdef" });
    await seedOrder({ order_no: "100234" });

    expect(
      (await listAdminOrders({ query: "sub_abc" })).map((o) => o.order_no)
    ).toEqual(["renewal:sub_abc:1767225600"]);
    expect(
      (await listAdminOrders({ query: "0192f3a1" })).map((o) => o.order_no)
    ).toEqual(["0192f3a1-7000-7000-8000-abcdefabcdef"]);
    expect(await countAdminOrders({ query: "100234" })).toBe(1);
  });

  it("finds every cycle a subscription ever billed", async () => {
    await seedOrder({ order_no: "renewal:sub_x:1", sub_id: "sub_x" });
    await seedOrder({ order_no: "renewal:sub_x:2", sub_id: "sub_x" });
    await seedOrder({ order_no: "renewal:sub_y:1", sub_id: "sub_y" });

    expect(await countAdminOrders({ query: "sub_x" })).toBe(2);
  });

  it("finds an order by the tenant its credits landed in", async () => {
    await seedOrder({ order_no: "o-1", org_uuid: "org-alpha" });
    await seedOrder({ order_no: "o-2", org_uuid: "org-beta" });

    expect(
      (await listAdminOrders({ query: "org-alpha" })).map((o) => o.order_no)
    ).toEqual(["o-1"]);
  });

  it("combines the status filter with the search rather than replacing it", async () => {
    // Both orders match the term; only one matches the status. A filter that
    // replaced the other would return two rows or three.
    await seedOrder({ order_no: "renewal:sub_z:1", status: OrderStatus.Paid });
    await seedOrder({ order_no: "renewal:sub_z:2", status: OrderStatus.Created });
    await seedOrder({ order_no: "unrelated", status: OrderStatus.Paid });

    const rows = await listAdminOrders({
      status: OrderStatus.Paid,
      query: "sub_z",
    });

    expect(rows.map((o) => o.order_no)).toEqual(["renewal:sub_z:1"]);
    expect(
      await countAdminOrders({ status: OrderStatus.Paid, query: "sub_z" })
    ).toBe(1);
  });

  it("counts through the same filter the rows came from", async () => {
    await seedOrder({ order_no: "a", status: OrderStatus.Paid });
    await seedOrder({ order_no: "b", status: OrderStatus.Paid });
    await seedOrder({ order_no: "c", status: OrderStatus.Created });

    expect(await countAdminOrders()).toBe(3);
    expect(await countAdminOrders({ status: OrderStatus.Paid })).toBe(2);
    expect(await countAdminOrdersByStatus()).toEqual({ paid: 2, created: 1 });
  });

  it("orders newest first, with a tiebreak that survives a null created_at", async () => {
    // `orders.created_at` is nullable on this table. Without the id tiebreak
    // the page order is whatever the scan produced, which makes pagination drop
    // and repeat rows between pages.
    await seedOrder({ order_no: "older", created_at: new Date("2026-01-01") });
    await seedOrder({ order_no: "newer", created_at: new Date("2026-06-01") });

    expect((await listAdminOrders({})).map((o) => o.order_no)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("never returns the raw provider payload columns", async () => {
    await seedOrder({ order_no: "o-secret" });

    const [row] = await listAdminOrders({ query: "o-secret" });

    expect(Object.keys(row)).not.toContain("order_detail");
    expect(Object.keys(row)).not.toContain("paid_detail");
    expect(Object.keys(row)).toContain("order_no");
  });
});

describeDb("did an order's credits reach the ledger", () => {
  it("links a grant to its order", async () => {
    await seedOrder({ order_no: "o-granted", credits: 100 });
    await seedGrant("o-granted", 100);

    const ledger = await findCreditsByOrderNos(["o-granted"]);

    expect(ledger).toHaveLength(1);
    expect(ledger[0].credits).toBe(100);
  });

  it("reports nothing for a paid order whose credits never landed", async () => {
    // Roadmap item 4's defect, seen from one row instead of a bulk sweep. The
    // customer paid, the ledger has nothing, and no error was ever raised.
    await seedOrder({ order_no: "o-missing", credits: 100 });

    expect(await findCreditsByOrderNos(["o-missing"])).toEqual([]);
  });

  it("reports both rows when one order was granted twice", async () => {
    // The opposite defect, and just as worth seeing: one order pays out once.
    await seedOrder({ order_no: "o-double", credits: 100 });
    await seedGrant("o-double", 100, "trans-a");
    await seedGrant("o-double", 100, "trans-b");

    expect(await findCreditsByOrderNos(["o-double"])).toHaveLength(2);
  });

  it("resolves a page of orders in one query", async () => {
    await seedOrder({ order_no: "p-1" });
    await seedOrder({ order_no: "p-2" });
    await seedOrder({ order_no: "p-3" });
    await seedGrant("p-1", 10);
    await seedGrant("p-3", 30);

    const ledger = await findCreditsByOrderNos(["p-1", "p-2", "p-3"]);
    const byOrder = new Map(ledger.map((row) => [row.order_no, row.credits]));

    expect(byOrder.get("p-1")).toBe(10);
    expect(byOrder.get("p-2")).toBeUndefined();
    expect(byOrder.get("p-3")).toBe(30);
  });

  it("asks for nothing when the page is empty", async () => {
    expect(await findCreditsByOrderNos([])).toEqual([]);
  });
});
