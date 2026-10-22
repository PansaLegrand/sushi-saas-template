import { AppError } from "@/lib/errors";
import { throwIfAborted } from "@/lib/abort";

export type ErasableTaskOutput = {
  uuid: string;
  output_url: string | null;
  output_json: string | null;
  org_uuid: string;
};

export interface AccountLifecycleExternalDataAdapter {
  /**
   * Remove a task artifact from the configured AI/provider system.
   *
   * Implementations must be idempotent: a crash may replay the call after the
   * provider deleted the artifact but before the database recorded success.
   */
  deleteTaskOutput(
    task: ErasableTaskOutput,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

let externalDataAdapter: AccountLifecycleExternalDataAdapter | undefined;

/**
 * Register provider-specific erasure when replacing the demo AI adapter.
 *
 * The default fails closed for an external URL. Deleting a database row while
 * leaving a provider-hosted video behind would be a false erasure claim.
 */
export function setAccountLifecycleExternalDataAdapter(
  adapter: AccountLifecycleExternalDataAdapter,
): void {
  externalDataAdapter = adapter;
}

export async function deleteTaskOutputForErasure(
  task: ErasableTaskOutput,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!task.output_url || task.output_url.startsWith("/")) return;

  if (!externalDataAdapter) {
    throw new AppError("ACCOUNT_LIFECYCLE_FAILED", {
      message:
        "external task output exists but no account lifecycle data adapter is registered",
    });
  }

  await externalDataAdapter.deleteTaskOutput(task, { signal });
  throwIfAborted(signal);
}

export function resetAccountLifecycleExternalDataAdapterForTests(): void {
  externalDataAdapter = undefined;
}
