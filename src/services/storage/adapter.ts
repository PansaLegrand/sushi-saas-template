import type { CreateUploadRequest, CreateUploadResponse, SignedDownloadUrl } from "@/types/storage";
import { getAppEnv, getRequiredEnv } from "@/lib/env";

export interface StorageAdapter {
  readonly provider: string;
  getDefaultBucket(): string;
  buildObjectKey(params: { userUuid: string; filename: string }): string;
  getPresignedUpload(params: {
    bucket: string;
    key: string;
    contentType: string;
    size: number;
    checksumSha256?: string;
    metadata?: Record<string, string>;
    expiresIn?: number; // seconds
  }): Promise<CreateUploadResponse>;
  getPresignedDownload(params: {
    bucket: string;
    key: string;
    filename?: string;
    expiresIn?: number; // seconds
    responseContentType?: string;
  }): Promise<SignedDownloadUrl>;
  /** Server-side write used for private lifecycle artifacts. */
  putObject(params: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<void>;
  headObject(params: { bucket: string; key: string }): Promise<
    | {
        size: number;
        etag?: string;
        contentType?: string;
        checksumSHA256?: string;
        storageClass?: string;
      }
    | null
  >;
  deleteObject(params: { bucket: string; key: string }): Promise<void>;
}

export interface StorageConfig {
  provider: string;
  bucket: string;
}

export function getStorageConfig(): StorageConfig {
  const env = getAppEnv();
  const provider = env.STORAGE_PROVIDER;
  const bucket = getRequiredEnv("STORAGE_BUCKET");
  return { provider, bucket };
}
