import { Resend } from "resend";
import { render } from "@react-email/render";

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
};

const resendApiKey = process.env.RESEND_API_KEY;
const defaultFrom = process.env.EMAIL_FROM;

export async function sendMail({ to, subject, html, text, from, attachments }: MailInput) {
  if (!resendApiKey) throw new Error("RESEND_API_KEY not set");
  const fromEmail = from ?? defaultFrom;
  if (!fromEmail) throw new Error("EMAIL_FROM not set");

  const client = new Resend(resendApiKey!);
  const res = await client.emails.send({
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
  });

  if ((res as any).error) throw (res as any).error;
  return res;
}

export async function sendWelcomeEmail(to: string, name?: string) {
  const { default: WelcomeEmail } = await import("./templates/welcome");
  const html = render(WelcomeEmail({ name }));
  return sendMail({ to, subject: "Welcome to our app!", html });
}

export async function sendPaymentSuccessEmail(
  to: string,
  opts: { orderNo?: string; amount?: number | null; currency?: string | null } = {}
) {
  const { default: PaymentSuccess } = await import("./templates/payment-success");
  const html = render(
    PaymentSuccess({
      orderNo: opts.orderNo,
      amount: typeof opts.amount === "number" ? opts.amount : undefined,
      currency: opts.currency ?? undefined,
    })
  );
  return sendMail({ to, subject: "Payment received", html });
}

export async function sendPaymentFailedEmail(
  to: string,
  opts: { invoiceNumber?: string | null; amount?: number | null; currency?: string | null; manageUrl?: string }
) {
  const { default: PaymentFailed } = await import("./templates/payment-failed");
  const html = render(
    PaymentFailed({
      invoiceNumber: opts.invoiceNumber ?? undefined,
      amount: typeof opts.amount === "number" ? opts.amount : undefined,
      currency: opts.currency ?? undefined,
      manageUrl: opts.manageUrl,
    })
  );
  return sendMail({ to, subject: "Payment failed — update your payment method", html });
}

export async function sendResetPasswordEmail(to: string, url: string) {
  const { default: ResetPassword } = await import("./templates/reset-password");
  const html = render(ResetPassword({ url }));
  return sendMail({ to, subject: "Reset your password", html, text: `Open this link to reset your password: ${url}` });
}

export async function sendReservationConfirmedEmail(
  to: string,
  opts: { reservationNo: string; serviceTitle?: string; startsAt?: string; timezone?: string; icsContent?: string; googleCalendarUrl?: string }
) {
  const { default: ReservationConfirmed } = await import("./templates/reservation-confirmed");
  const html = render(
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
  });
}
