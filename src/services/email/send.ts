import { Resend } from "resend";
import { render } from "@react-email/render";
import { getRequiredEnv } from "@/lib/env";

type Attachment = {
  filename: string;
  content: Buffer | string;
  type?: string;
};

export type MailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  attachments?: Attachment[];
  /**
   * Stable across retries of one durable job. Never include an attempt number:
   * a timeout can happen after Resend accepted the message.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export type MailDeliveryOptions = Pick<
  MailInput,
  "idempotencyKey" | "signal"
>;

export async function sendMail({
  to,
  subject,
  html,
  text,
  from,
  attachments,
  idempotencyKey,
  signal,
}: MailInput) {
  const resendApiKey = getRequiredEnv("RESEND_API_KEY");
  const fromEmail = from ?? getRequiredEnv("EMAIL_FROM");

  const client = new Resend(resendApiKey);
  const message = {
    from: fromEmail,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
    attachments: attachments?.map((a) => ({
      filename: a.filename,
      content: typeof a.content === "string" ? a.content : a.content.toString("base64"),
      type: a.type,
    })),
  };
  // Resend 4.8 types expose `idempotencyKey` but not the underlying fetch
  // signal. Its request implementation spreads these options into RequestInit,
  // so the signal reaches fetch while the key becomes Idempotency-Key.
  const requestOptions = { idempotencyKey, signal };
  const res =
    idempotencyKey || signal
      ? await client.emails.send(message, requestOptions)
      : await client.emails.send(message);

  if ((res as any).error) throw (res as any).error;
  return res;
}

export async function sendWelcomeEmail(
  to: string,
  name?: string,
  delivery: MailDeliveryOptions = {},
) {
  const { default: WelcomeEmail } = await import("./templates/welcome");
  const html = await render(WelcomeEmail({ name }));
  return sendMail({
    to,
    subject: "Welcome to our app!",
    html,
    ...delivery,
  });
}

export async function sendPaymentSuccessEmail(
  to: string,
  opts: {
    orderNo?: string;
    amount?: number | null;
    currency?: string | null;
  } = {},
  delivery: MailDeliveryOptions = {},
) {
  const { default: PaymentSuccess } = await import("./templates/payment-success");
  const html = await render(
    PaymentSuccess({
      orderNo: opts.orderNo,
      amount: typeof opts.amount === "number" ? opts.amount : undefined,
      currency: opts.currency ?? undefined,
    })
  );
  return sendMail({
    to,
    subject: "Payment received",
    html,
    ...delivery,
  });
}

export async function sendPaymentFailedEmail(
  to: string,
  opts: {
    invoiceNumber?: string | null;
    amount?: number | null;
    currency?: string | null;
    manageUrl?: string;
  },
  delivery: MailDeliveryOptions = {},
) {
  const { default: PaymentFailed } = await import("./templates/payment-failed");
  const html = await render(
    PaymentFailed({
      invoiceNumber: opts.invoiceNumber ?? undefined,
      amount: typeof opts.amount === "number" ? opts.amount : undefined,
      currency: opts.currency ?? undefined,
      manageUrl: opts.manageUrl,
    })
  );
  return sendMail({
    to,
    subject: "Payment failed — update your payment method",
    html,
    ...delivery,
  });
}

export async function sendResetPasswordEmail(to: string, url: string) {
  const { default: ResetPassword } = await import("./templates/reset-password");
  const html = await render(ResetPassword({ url }));
  return sendMail({ to, subject: "Reset your password", html, text: `Open this link to reset your password: ${url}` });
}

export async function sendVerifyEmail(to: string, url: string) {
  const { default: VerifyEmail } = await import("./templates/verify-email");
  const html = await render(VerifyEmail({ url }));
  return sendMail({
    to,
    subject: "Verify your email",
    html,
    text: `Open this link to verify your email: ${url}`,
  });
}

export async function sendReservationConfirmedEmail(
  to: string,
  opts: {
    reservationNo: string;
    serviceTitle?: string;
    startsAt?: string;
    timezone?: string;
    icsContent?: string;
    googleCalendarUrl?: string;
  },
  delivery: MailDeliveryOptions = {},
) {
  const { default: ReservationConfirmed } = await import("./templates/reservation-confirmed");
  const html = await render(
    ReservationConfirmed({
      reservationNo: opts.reservationNo,
      serviceTitle: opts.serviceTitle,
      startsAt: opts.startsAt,
      timezone: opts.timezone,
      googleCalendarUrl: opts.googleCalendarUrl,
    })
  );
  return sendMail({
    to,
    subject: "Your reservation is confirmed",
    html,
    attachments: opts.icsContent
      ? [
          {
            filename: `reservation-${opts.reservationNo}.ics`,
            content: opts.icsContent,
            type: "text/calendar",
          },
        ]
      : undefined,
    ...delivery,
  });
}

export async function sendOrgInvitationEmail(
  to: string,
  opts: {
    url: string;
    organizationName: string;
    inviterName?: string;
    expiresInHours?: number;
  },
  delivery: MailDeliveryOptions = {},
) {
  const { default: OrgInvitation } = await import("./templates/org-invitation");
  const html = await render(
    OrgInvitation({
      url: opts.url,
      organizationName: opts.organizationName,
      inviterName: opts.inviterName,
      expiresInHours: opts.expiresInHours,
    })
  );

  return sendMail({
    to,
    // The organization is in the subject line so the recipient can tell a real
    // invitation from a generic one before opening it.
    subject: `You have been invited to join ${opts.organizationName}`,
    html,
    text: `Open this link to join ${opts.organizationName}: ${opts.url}`,
    ...delivery,
  });
}
