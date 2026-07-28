/**
 * Database tier: checkout purchase-intent uniqueness.
 *
 * The service can ask PostgreSQL to collapse a double-click, but only this test
 * proves the unique index really allows one order per organization and intent
 * while still allowing multiple deliberate intents—and the same random key in
 * an unrelated organization.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  findOrderByCheckoutIntent,
  insertOrderForCheckoutIntent,
  OrderStatus,
  type OrderInsert,
} from "@/models/order";
import { describeDb, useCleanDatabase } from "./setup";

useCleanDatabase();

function checkoutOrder(input: {
  orgUuid: string;
  checkoutIntentId: string;
  orderNo?: string;
}): OrderInsert & { checkout_intent_id: string } {
  return {
    order_no: input.orderNo ?? randomUUID(),
    created_at: new Date(),
    org_uuid: input.orgUuid,
    user_uuid: "user-1",
    user_email: "owner@example.test",
    amount: 7_900,
    interval: "month",
    status: OrderStatus.Created,
    credits: 2_500,
    currency: "usd",
    product_id: "max-monthly",
    product_name: "Max Monthly",
    valid_months: 1,
    checkout_intent_id: input.checkoutIntentId,
    checkout_fingerprint: "a".repeat(64),
    stripe_price_id: "price_1MaxMonth",
    checkout_locale: "en",
  };
}

describeDb("checkout intent uniqueness", () => {
  it("allows only one order for concurrent copies of one intent", async () => {
    const intentId = randomUUID();
    const [first, second] = await Promise.all([
      insertOrderForCheckoutIntent(
        checkoutOrder({
          orgUuid: "org-1",
          checkoutIntentId: intentId,
          orderNo: "order-1",
        })
      ),
      insertOrderForCheckoutIntent(
        checkoutOrder({
          orgUuid: "org-1",
          checkoutIntentId: intentId,
          orderNo: "order-2",
        })
      ),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(
      await findOrderByCheckoutIntent("org-1", intentId)
    ).toMatchObject({
      order_no: first?.order_no ?? second?.order_no,
      checkout_intent_id: intentId,
    });
  });

  it("allows multiple deliberate intents in one organization", async () => {
    const first = await insertOrderForCheckoutIntent(
      checkoutOrder({
        orgUuid: "org-1",
        checkoutIntentId: randomUUID(),
      })
    );
    const second = await insertOrderForCheckoutIntent(
      checkoutOrder({
        orgUuid: "org-1",
        checkoutIntentId: randomUUID(),
      })
    );

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.order_no).not.toBe(second?.order_no);
  });

  it("scopes an intent key to the organization", async () => {
    const intentId = randomUUID();
    const first = await insertOrderForCheckoutIntent(
      checkoutOrder({
        orgUuid: "org-1",
        checkoutIntentId: intentId,
      })
    );
    const second = await insertOrderForCheckoutIntent(
      checkoutOrder({
        orgUuid: "org-2",
        checkoutIntentId: intentId,
      })
    );

    expect(first).toBeDefined();
    expect(second).toBeDefined();
  });
});
