import {
  sendPaymentFailedEmail,
  sendPaymentSuccessEmail,
  sendOrgInvitationEmail,
  sendReservationConfirmedEmail,
  sendWelcomeEmail,
} from "@/services/email/send";
import { sendSlackMessage } from "@/integrations/slack";
import {
  CreditsTransType,
  increaseCredits,
  getOrgCreditSummary,
} from "@/services/credit";
import { findPersonalOrganizationByUserUuid } from "@/models/organization";
import type { JobHandlerMap } from "./types";

/**
 * Handlers must be idempotent: a job can be retried after a partial failure, or
 * re-run if a runner died mid-flight without releasing its lock.
 */
export const jobHandlers: JobHandlerMap = {
  welcome_email: async ({ email, name }) => {
    await sendWelcomeEmail(email, name);
  },

  org_invitation_email: async ({ to, url, organizationName, inviterName, expiresInHours }) => {
    await sendOrgInvitationEmail(to, {
      url,
      organizationName,
      inviterName,
      expiresInHours,
    });
  },

  new_user_credits: async ({ userUuid, credits }) => {
    // Deterministic trans_no: the ledger's unique constraint makes a replay a
    // no-op rather than a second grant.
    const transNo = `new_user_${userUuid}`;

    // The organization is resolved here rather than carried in the payload, so
    // that jobs already queued when this deployed still run. Changing a payload
    // shape strands every in-flight job of that type.
    const org = await findPersonalOrganizationByUserUuid(userUuid);
    if (!org) {
      throw new Error(`no personal organization for user ${userUuid}`);
    }

    try {
      await increaseCredits({
        org_uuid: org.uuid,
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
    await getOrgCreditSummary(org.uuid, { includeLedger: false });
  },

  payment_success_email: async ({ to, orderNo, amount, currency }) => {
    await sendPaymentSuccessEmail(to, { orderNo, amount, currency });
  },

  payment_failed_email: async ({ to, invoiceNumber, amount, currency, manageUrl }) => {
    await sendPaymentFailedEmail(to, {
      invoiceNumber,
      amount,
      currency,
      manageUrl,
    });
  },

  reservation_confirmed_email: async ({
    to,
    reservationNo,
    serviceTitle,
    startsAt,
    timezone,
    icsContent,
    googleCalendarUrl,
  }) => {
    await sendReservationConfirmedEmail(to, {
      reservationNo,
      serviceTitle,
      startsAt,
      timezone,
      icsContent,
      googleCalendarUrl,
    });
  },

  slack_event: async ({ title, context }) => {
    await sendSlackMessage(`:white_check_mark: ${title}`, context);
  },

  slack_error: async ({ title, context, error }) => {
    await sendSlackMessage(`:rotating_light: ${title}`, {
      ...(context ?? {}),
      error: error ?? "",
    });
  },
};
