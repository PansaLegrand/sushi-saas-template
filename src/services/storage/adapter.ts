import type { CreateUploadRequest, CreateUploadResponse, SignedDownloadUrl } from "@/types/storage";

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
  const provider = (process.env.STORAGE_PROVIDER || "s3").toLowerCase();
  const bucket = process.env.S3_BUCKET || process.env.STORAGE_BUCKET || "";
  if (!bucket) {
    throw new Error("STORAGE_BUCKET/S3_BUCKET is not configured");
  }
  return { provider, bucket };
}
