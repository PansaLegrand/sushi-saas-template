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
}

export type JobType = keyof JobPayloads;

export type JobHandler<T extends JobType> = (
  payload: JobPayloads[T]
) => Promise<void>;

export type JobHandlerMap = {
  [T in JobType]: JobHandler<T>;
};
