import { sendWelcomeEmail } from "@/services/email/send";
import {
  CreditsTransType,
  increaseCredits,
  getUserCreditSummary,
} from "@/services/credit";
import type { JobHandlerMap } from "./types";

/**
 * Handlers must be idempotent: a job can be retried after a partial failure, or
 * re-run if a runner died mid-flight without releasing its lock.
 */
export const jobHandlers: JobHandlerMap = {
  welcome_email: async ({ email, name }) => {
    await sendWelcomeEmail(email, name);
  },

  new_user_credits: async ({ userUuid, credits }) => {
    // Deterministic trans_no: the ledger's unique constraint makes a replay a
    // no-op rather than a second grant.
    const transNo = `new_user_${userUuid}`;

    try {
      await increaseCredits({
        user_uuid: userUuid,
        trans_type: CreditsTransType.NewUser,
        credits,
        trans_no: transNo,
        order_no: "",
      });
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      const causeCode = (e as { cause?: { code?: string } } | null)?.cause?.code;
      // 23505 = unique violation, i.e. already granted.
      if (code !== "23505" && causeCode !== "23505") throw e;
    }

    // Surfaces the resulting balance in the runner log for debugging.
    await getUserCreditSummary(userUuid, { includeLedger: false });
  },
};
