export type StorageProvider = "s3" | "r2" | "gcs" | "minio";

export interface FileObject {
  id: number;
  uuid: string;
  user_uuid: string;
  provider: string;
  bucket: string;
  key: string;
  region?: string | null;
  endpoint?: string | null;
  version_id?: string | null;
  size: number;
  content_type: string;
  etag?: string | null;
  checksum_sha256?: string | null;
  storage_class?: string | null;
  original_filename: string;
  extension: string;
  visibility: "private" | "public" | "org";
  status: "uploading" | "active" | "deleted" | "failed";
  metadata_json?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface CreateUploadRequest {
  filename: string;
  contentType: string;
  size: number;
  checksumSha256?: string; // base64-encoded
  visibility?: "private" | "public" | "org";
  metadata?: Record<string, string>;
}

export interface CreateUploadResponse {
  fileUuid: string;
  bucket: string;
  key: string;
  uploadUrl: string;
  method: "PUT";
  headers?: Record<string, string>;
  expiresIn: number;
}

export interface CompleteUploadRequest {
  fileUuid: string;
}

export interface SignedDownloadUrl {
  url: string;
  expiresIn: number;
}

