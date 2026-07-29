/**
 * Payload shape per job type.
 *
 * Payloads are persisted as JSON and may be read back by a deploy newer than
 * the one that enqueued them, so treat these as a wire format: add optional
 * fields, do not repurpose existing ones.
 */
export interface JobPayloads {
  welcome_email: {
    email: string;
    name?: string;
    userUuid?: string;
  };
  new_user_credits: {
    userUuid: string;
    credits: number;
  };
  storage_object_delete: {
    fileUuid: string;
    orgUuid: string;
  };
  account_data_export: {
    requestUuid: string;
  };
  account_export_expire: {
    requestUuid: string;
  };
  account_erasure: {
    requestUuid: string;
  };
  payment_success_email: {
    to: string;
    orderNo?: string;
    amount?: number | null;
    currency?: string | null;
  };
  payment_failed_email: {
    to: string;
    invoiceNumber?: string | null;
    amount?: number | null;
    currency?: string | null;
    manageUrl?: string;
  };
  reservation_confirmed_email: {
    to: string;
    reservationNo: string;
    serviceTitle?: string;
    startsAt?: string;
    timezone?: string;
    icsContent?: string;
    googleCalendarUrl?: string;
  };
  org_invitation_email: {
    to: string;
    url: string;
    organizationName: string;
    inviterName?: string;
    expiresInHours?: number;
  };
  slack_event: {
    title: string;
    context?: Record<string, unknown>;
  };
  slack_error: {
    title: string;
    context?: Record<string, unknown>;
    error?: string;
  };
}

export type JobType = keyof JobPayloads;

/**
 * Stable execution identity supplied by the runner on every attempt.
 *
 * `jobUuid` deliberately does not change between retries, so providers can use
 * it as an idempotency key. `attempt` is diagnostic only and must not be mixed
 * into an external idempotency key.
 */
export type JobHandlerContext = {
  jobUuid: string;
  attempt: number;
  maxAttempts: number;
  signal: AbortSignal;
};

export type JobHandler<T extends JobType> = (
  payload: JobPayloads[T],
  context: JobHandlerContext,
) => Promise<void>;

export type JobHandlerMap = {
  [T in JobType]: JobHandler<T>;
};
