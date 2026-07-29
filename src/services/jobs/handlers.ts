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
import { deleteStoredObject } from "@/services/storage/delete-worker";
import type { JobHandlerContext, JobHandlerMap } from "./types";

function queuedMailDelivery(context: JobHandlerContext) {
  return {
    // Attempts intentionally share one key. A worker can time out after Resend
    // accepted a message but before the response reached us.
    idempotencyKey: `job-${context.jobUuid}`,
    signal: context.signal,
  };
}

/**
 * Handlers must be idempotent: a job can be retried after a partial failure, or
 * re-run if a runner died mid-flight without releasing its lock.
 */
export const jobHandlers: JobHandlerMap = {
  welcome_email: async ({ email, name }, context) => {
    await sendWelcomeEmail(email, name, queuedMailDelivery(context));
  },

  org_invitation_email: async (
    { to, url, organizationName, inviterName, expiresInHours },
    context,
  ) => {
    await sendOrgInvitationEmail(
      to,
      {
        url,
        organizationName,
        inviterName,
        expiresInHours,
      },
      queuedMailDelivery(context),
    );
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
        // Us, not the new user: nobody paid and nobody asked.
        actor: "system:new_user",
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

  storage_object_delete: async ({ fileUuid, orgUuid }) => {
    await deleteStoredObject({ fileUuid, orgUuid });
  },

  account_data_export: async ({ requestUuid }) => {
    // Dynamic import avoids making the auth configuration and the job registry
    // initialize each other. Lifecycle route helpers use `auth`; workers do not
    // need it, and are loaded only when their durable job actually runs.
    const { runAccountDataExport } = await import(
      "@/services/account-lifecycle"
    );
    await runAccountDataExport({ requestUuid });
  },

  account_export_expire: async ({ requestUuid }) => {
    const { expireAccountExport } = await import(
      "@/services/account-lifecycle"
    );
    await expireAccountExport({ requestUuid });
  },

  account_erasure: async ({ requestUuid }) => {
    const { runAccountErasure } = await import(
      "@/services/account-lifecycle"
    );
    await runAccountErasure({ requestUuid });
  },

  payment_success_email: async (
    { to, orderNo, amount, currency },
    context,
  ) => {
    await sendPaymentSuccessEmail(
      to,
      { orderNo, amount, currency },
      queuedMailDelivery(context),
    );
  },

  payment_failed_email: async (
    { to, invoiceNumber, amount, currency, manageUrl },
    context,
  ) => {
    await sendPaymentFailedEmail(
      to,
      {
        invoiceNumber,
        amount,
        currency,
        manageUrl,
      },
      queuedMailDelivery(context),
    );
  },

  reservation_confirmed_email: async ({
    to,
    reservationNo,
    serviceTitle,
    startsAt,
    timezone,
    icsContent,
    googleCalendarUrl,
  }, context) => {
    await sendReservationConfirmedEmail(
      to,
      {
        reservationNo,
        serviceTitle,
        startsAt,
        timezone,
        icsContent,
        googleCalendarUrl,
      },
      queuedMailDelivery(context),
    );
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
