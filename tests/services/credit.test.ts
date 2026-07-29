/**
 * Credit service projection and refund orchestration.
 *
 * The real-database suite proves FEFO arithmetic. This file pins the service
 * boundary around it: customer/admin summaries must publish the model's exact
 * spendable number, expiring warnings must show the remaining bucket amount,
 * and a logical multi-row spend must be refunded through one atomic model call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CreditAllocation,
  CreditBalanceSnapshot,
  CreditRow,
} from "@/models/credit";

const mocks = vi.hoisted(() => ({
  findCreditSpendRefundPlan:
    vi.fn<typeof import("@/models/credit").findCreditSpendRefundPlan>(),
  findCreditByTransNo:
    vi.fn<typeof import("@/models/credit").findCreditByTransNo>(),
  getOrgCreditLedgerSnapshot:
    vi.fn<typeof import("@/models/credit").getOrgCreditLedgerSnapshot>(),
  insertCredit: vi.fn<typeof import("@/models/credit").insertCredit>(),
  insertCreditRefund:
    vi.fn<typeof import("@/models/credit").insertCreditRefund>(),
  insertSpendCreditIfSufficient:
    vi.fn<typeof import("@/models/credit").insertSpendCreditIfSufficient>(),
  getFirstPaidOrderByOrg:
    vi.fn<typeof import("@/models/order").getFirstPaidOrderByOrg>(),
}));

vi.mock("@/models/credit", () => ({
  findCreditSpendRefundPlan: mocks.findCreditSpendRefundPlan,
  findCreditByTransNo: mocks.findCreditByTransNo,
  getOrgCreditLedgerSnapshot: mocks.getOrgCreditLedgerSnapshot,
  insertCredit: mocks.insertCredit,
  insertCreditRefund: mocks.insertCreditRefund,
  insertSpendCreditIfSufficient: mocks.insertSpendCreditIfSufficient,
}));

vi.mock("@/models/order", () => ({
  getFirstPaidOrderByOrg: mocks.getFirstPaidOrderByOrg,
}));

import {
  CreditsTransType,
  getOrgCreditSummary,
  getOrgCredits,
  refundCreditsForTransaction,
} from "@/services/credit";

const NOW = new Date("2026-07-29T00:00:00.000Z");

function creditRow(overrides: Partial<CreditRow> = {}): CreditRow {
  return {
    id: 1,
    trans_no: "grant-1",
    created_at: new Date("2026-07-28T00:00:00.000Z"),
    user_uuid: "user-1",
    trans_type: CreditsTransType.OrderPay,
    credits: 10,
    order_no: "order-1",
    expired_at: new Date("2026-08-02T00:00:00.000Z"),
    org_uuid: "org-1",
    balance_after: 10,
    actor: "stripe:webhook",
    metadata_json: null,
    ...overrides,
  };
}

function balanceSnapshot(
  overrides: Partial<CreditBalanceSnapshot> = {},
): CreditBalanceSnapshot {
  return {
    available: 6,
    activeGranted: 10,
    activeConsumed: 4,
    expired: 0,
    buckets: [{ source: creditRow(), remaining: 6 }],
    allocationsByTransNo: new Map(),
    ...overrides,
  };
}

describe("credit service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    mocks.getOrgCreditLedgerSnapshot.mockResolvedValue({
      rows: [creditRow()],
      logicalRows: [creditRow()],
      balance: balanceSnapshot(),
    });
    mocks.getFirstPaidOrderByOrg.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes the exact spendable snapshot and remaining expiry amount", async () => {
    const summary = await getOrgCreditSummary("org-1");

    expect(summary).toMatchObject({
      balance: 6,
      granted: 10,
      consumed: 4,
      expired: 0,
    });
    expect(summary.expiringSoon).toHaveLength(1);
    expect(summary.expiringSoon[0]).toMatchObject({
      transNo: "grant-1",
      credits: 6,
    });
    expect(mocks.getOrgCreditLedgerSnapshot).toHaveBeenCalledWith("org-1", NOW);
  });

  it("uses that same summary balance for the lightweight credit status", async () => {
    const status = await getOrgCredits("org-1");

    expect(status).toEqual({
      left_credits: 6,
      is_pro: true,
      is_recharged: false,
    });
    expect(mocks.getOrgCreditLedgerSnapshot).toHaveBeenCalledTimes(1);
  });

  it("uses logical rows for customers and physical rows for admin audit", async () => {
    const root = creditRow({
      id: 2,
      trans_no: "spend-root",
      trans_type: CreditsTransType.TaskTextToVideo,
      credits: -2,
      order_no: "early-order",
      balance_after: 8,
      metadata_json: JSON.stringify({
        task_uuid: "task-1",
        __credit_fefo: {
          version: 1,
          root_trans_no: "spend-root",
          part_trans_nos: ["spend-root", "spend-root:part:2"],
          part_index: 0,
          source_trans_nos: ["grant-early"],
        },
      }),
    });
    const child = creditRow({
      ...root,
      id: 3,
      trans_no: "spend-root:part:2",
      credits: -3,
      order_no: "later-order",
      balance_after: 5,
      metadata_json: JSON.stringify({
        task_uuid: "task-1",
        __credit_fefo: {
          version: 1,
          root_trans_no: "spend-root",
          part_trans_nos: ["spend-root", "spend-root:part:2"],
          part_index: 1,
          source_trans_nos: ["grant-later"],
        },
      }),
    });
    const logical = creditRow({
      ...root,
      credits: -5,
      order_no: null,
      expired_at: null,
      balance_after: 5,
      metadata_json: JSON.stringify({ task_uuid: "task-1" }),
    });
    mocks.getOrgCreditLedgerSnapshot.mockResolvedValue({
      rows: [child, root],
      logicalRows: [logical],
      balance: balanceSnapshot({ buckets: [] }),
    });

    const customer = await getOrgCreditSummary("org-1", { ledgerLimit: 1 });
    const admin = await getOrgCreditSummary("org-1", {
      ledgerLimit: 2,
      includeAudit: true,
    });

    expect(customer.ledger).toEqual([
      expect.objectContaining({
        transNo: "spend-root",
        credits: -5,
        balanceAfter: 5,
      }),
    ]);
    expect(customer.ledger[0]!.metadata).toBeUndefined();
    expect(admin.ledger.map((entry) => entry.transNo)).toEqual([
      "spend-root:part:2",
      "spend-root",
    ]);
    expect(admin.ledger[0]!.metadata).toHaveProperty("__credit_fefo");
  });

  it("passes every logical spend allocation to one atomic refund write", async () => {
    const original = creditRow({
      trans_no: "spend-root",
      trans_type: CreditsTransType.TaskTextToVideo,
      credits: -5,
      order_no: "early-order",
    });
    const allocations: CreditAllocation[] = [
      {
        credits: 2,
        expiredAt: new Date("2026-08-02T00:00:00.000Z"),
        orderNo: "early-order",
        sourceTransNos: ["grant-early"],
      },
      {
        credits: 3,
        expiredAt: new Date("2026-09-02T00:00:00.000Z"),
        orderNo: "later-order",
        sourceTransNos: ["grant-later"],
      },
    ];

    mocks.findCreditSpendRefundPlan.mockResolvedValue({
      original,
      parts: [
        original,
        creditRow({
          id: 2,
          trans_no: "spend-root:part:2",
          credits: -3,
          order_no: "later-order",
        }),
      ],
      allocations,
      complete: true,
    });
    mocks.findCreditByTransNo.mockResolvedValue(undefined);
    mocks.insertCreditRefund.mockResolvedValue(
      creditRow({
        id: 3,
        trans_no: "refund_spend-root",
        trans_type: CreditsTransType.TaskAdjust,
        credits: 2,
      }),
    );

    const result = await refundCreditsForTransaction({
      org_uuid: "org-1",
      user_uuid: "user-1",
      original_trans_no: "spend-root",
    });

    expect(result).toBe("refund_spend-root");
    expect(mocks.insertCreditRefund).toHaveBeenCalledWith({
      root_trans_no: "refund_spend-root",
      original_trans_no: "spend-root",
      original_trans_type: CreditsTransType.TaskTextToVideo,
      created_at: NOW,
      org_uuid: "org-1",
      user_uuid: "user-1",
      trans_type: CreditsTransType.TaskAdjust,
      allocations,
      actor: "system:credit_refund",
    });
  });
});
