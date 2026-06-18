import type { StorageAdapter } from "@/services/storage/adapter";
import { createS3Adapter } from "@/services/storage/s3";
import { getAppEnv } from "@/lib/env";

let adapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (adapter) return adapter;
  const provider = getAppEnv().STORAGE_PROVIDER;
  switch (provider) {
    case "s3":
    case "r2":
    case "minio":
      adapter = createS3Adapter();
      return adapter;
    default:
      adapter = createS3Adapter();
      return adapter;
  }
}
