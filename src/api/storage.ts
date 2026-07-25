import { api } from "@/lib/api/client";
import type { FileObject } from "@/types/storage";

export interface CreatedUpload {
  fileUuid: string;
  uploadUrl: string;
  method: "PUT";
  headers?: Record<string, string>;
}

export function listFiles(signal?: AbortSignal) {
  return api.get<{ items: FileObject[] }>("/api/storage/files", { signal });
}

export function getDownloadUrl(uuid: string) {
  return api.get<{ downloadUrl?: string }>(
    `/api/storage/files/${encodeURIComponent(uuid)}`,
    { query: { download: 1 } }
  );
}

export function deleteFile(uuid: string) {
  return api.delete<unknown>(`/api/storage/files/${encodeURIComponent(uuid)}`);
}

export function createUpload(input: {
  filename: string;
  contentType: string;
  size: number;
}) {
  return api.post<CreatedUpload>("/api/storage/uploads", { body: input });
}

export function completeUpload(fileUuid: string) {
  return api.post<{ file?: FileObject }>("/api/storage/uploads/complete", {
    body: { fileUuid },
  });
}
