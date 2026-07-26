"use client";

import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { UploadCloud } from "lucide-react";

import { completeUpload, createUpload } from "@/api/storage";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_STORAGE_UPLOAD_POLICY_ID,
  acceptStringForUploadPolicy,
  getStorageUploadPolicy,
  isAllowedUploadType,
  matchesAcceptToken,
  normalizeContentType,
  type StorageUploadPolicyId,
  type StorageUploadVisibility,
} from "@/config/storage";
import { resolveErrorMessage } from "@/lib/errors/client";
import type { ErrorCode } from "@/lib/errors/catalog";
import type { FileObject } from "@/types/storage";

type UploadItem = {
  id: string;
  clientId: string;
  name: string;
  size: number;
  status: "pending" | "uploading" | "verifying" | "done" | "error";
  progress: number;
  downloadUrl?: string;
};

type UploadMetadata =
  | Record<string, string>
  | ((file: File) => Record<string, string> | Promise<Record<string, string>>);

export type UploaderProps = {
  policy?: StorageUploadPolicyId;
  accept?: string | readonly string[];
  maxSizeMb?: number;
  multiple?: boolean;
  visibility?: StorageUploadVisibility;
  metadata?: UploadMetadata;
  checksum?: "none" | "sha256";
  label?: ReactNode;
  hint?: ReactNode;
  onUploaded?: (file: FileObject, source: File) => void;
  onUploadError?: (error: unknown, source: File) => void;
};

function uploadViaXHR(
  url: string,
  headers: Record<string, string> | undefined,
  file: File,
  onProgress?: (pct: number) => void
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (headers) {
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    }
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable) return;
      const pct = Math.round((evt.loaded / evt.total) * 100);
      onProgress?.(pct);
    };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.onload = () => {
      const res = new Response(xhr.responseText, { status: xhr.status, statusText: xhr.statusText });
      resolve(res);
    };
    xhr.send(file);
  });
}

function normalizeAccept(accept: string | readonly string[]): string[] {
  const values = typeof accept === "string" ? accept.split(",") : accept;
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function acceptsFile(params: {
  file: File;
  acceptTokens: string[];
  usePolicyValidation: boolean;
  policy: ReturnType<typeof getStorageUploadPolicy>;
}): boolean {
  const contentType = normalizeContentType(params.file.type || "application/octet-stream");

  if (params.usePolicyValidation) {
    return isAllowedUploadType(params.policy, {
      filename: params.file.name,
      contentType,
    });
  }

  return params.acceptTokens.some((token) =>
    matchesAcceptToken({
      token,
      filename: params.file.name,
      contentType,
    })
  );
}

function validationErrorForFile(params: {
  file: File;
  acceptTokens: string[];
  maxBytes: number;
  usePolicyValidation: boolean;
  policy: ReturnType<typeof getStorageUploadPolicy>;
}): ErrorCode | null {
  if (params.file.size > params.maxBytes) return "STORAGE_FILE_TOO_LARGE";
  if (!acceptsFile(params)) return "STORAGE_FILE_TYPE_NOT_ALLOWED";
  return null;
}

async function sha256Base64(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("STORAGE_CHECKSUM_INVALID");
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function resolveMetadata(
  metadata: UploadMetadata | undefined,
  file: File
): Promise<Record<string, string> | undefined> {
  if (!metadata) return undefined;
  return typeof metadata === "function" ? metadata(file) : metadata;
}

export function Uploader({
  policy = DEFAULT_STORAGE_UPLOAD_POLICY_ID,
  accept,
  maxSizeMb,
  multiple = true,
  visibility = "private",
  metadata,
  checksum,
  label,
  hint,
  onUploaded,
  onUploadError,
}: UploaderProps = {}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const t = useTranslations("storage");
  const locale = useLocale();
  const uploadPolicy = getStorageUploadPolicy(policy);
  const acceptAttr = accept ?? acceptStringForUploadPolicy(uploadPolicy);
  const acceptTokens = normalizeAccept(acceptAttr);
  const publicMaxMb = Number(process.env.NEXT_PUBLIC_UPLOAD_MAX_MB) || 25;
  const effectiveMaxMb =
    maxSizeMb ?? uploadPolicy.maxFileMb ?? publicMaxMb;
  const maxBytes = effectiveMaxMb * 1024 * 1024;
  const checksumMode = checksum ?? (uploadPolicy.requireChecksum ? "sha256" : "none");
  const usePolicyValidation = accept === undefined;

  const queueFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selected = Array.from(files);
    const next = selected.map((file) => {
      const clientId =
        globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
      return {
        id: clientId,
        clientId,
        name: file.name,
        size: file.size,
        status: "pending" as const,
        progress: 0,
      };
    });
    setItems((prev) => [...next, ...prev]);

    (async () => {
      for (const [index, f] of selected.entries()) {
        const item = next[index];
        const validationError = validationErrorForFile({
          file: f,
          acceptTokens,
          maxBytes,
          usePolicyValidation,
          policy: uploadPolicy,
        });

        if (validationError) {
          const error = new Error(validationError);
          toast.error(resolveErrorMessage(error, locale, validationError));
          onUploadError?.(error, f);
          setItems((prev) =>
            prev.map((it) => (it.clientId === item.clientId ? { ...it, status: "error" } : it))
          );
          continue;
        }

        try {
          const checksumSha256 =
            checksumMode === "sha256" ? await sha256Base64(f) : undefined;
          const created = await createUpload({
            filename: f.name,
            contentType: normalizeContentType(f.type || "application/octet-stream"),
            size: f.size,
            policy,
            visibility,
            checksumSha256,
            metadata: await resolveMetadata(metadata, f),
          });
          setItems((prev) =>
            prev.map((it) =>
              it.clientId === item.clientId
                ? { ...it, id: created.fileUuid, status: "uploading" }
                : it
            )
          );

          const res = await uploadViaXHR(created.uploadUrl, created.headers, f, (pct) => {
            setItems((prev) => prev.map((it) => (it.id === created.fileUuid ? { ...it, progress: pct } : it)));
          });

          // The PUT goes straight to object storage, not through our API, so
          // there is no envelope to read — only the status tells us anything.
          if (!res.ok) throw new Error("STORAGE_UPLOAD_FAILED");
          setItems((prev) => prev.map((it) => (it.id === created.fileUuid ? { ...it, status: "verifying", progress: 100 } : it)));
          const completed = await completeUpload(created.fileUuid);
          setItems((prev) => prev.map((it) => (it.id === created.fileUuid ? { ...it, status: "done" } : it)));
          if (completed.file) onUploaded?.(completed.file, f);
          toast.success(t("status.done" as any));
          // notify other components (e.g., FilesList) to refresh
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("files:refresh"));
          }
        } catch (error) {
          console.error(error);
          toast.error(resolveErrorMessage(error, locale, "STORAGE_UPLOAD_FAILED"));
          onUploadError?.(error, f);
          setItems((prev) =>
            prev.map((it) =>
              it.clientId === item.clientId &&
              (it.status === "pending" || it.status === "uploading" || it.status === "verifying")
                ? { ...it, status: "error" }
                : it
            )
          );
        }
      }
    })();
  }, [
    acceptTokens,
    checksumMode,
    locale,
    maxBytes,
    metadata,
    onUploaded,
    onUploadError,
    policy,
    uploadPolicy,
    usePolicyValidation,
    visibility,
    t,
  ]);

  const onSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    queueFiles(e.target.files);
  }, [queueFiles]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    queueFiles(e.dataTransfer.files);
  }, [queueFiles]);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setDragging(true);
  }, [isDragging]);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  return (
    <div className="space-y-5">
      <div
        className={
          "relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed bg-muted/30 p-8 text-center transition-colors " +
          (isDragging ? "border-primary bg-primary/5" : "border-border")
        }
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
      >
        <UploadCloud className="h-8 w-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">{label ?? t("uploadLabel")}</p>
          <p className="text-xs text-muted-foreground">
            {hint ?? t("hintPrivate", { mb: effectiveMaxMb })}
          </p>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
            Browse files
          </Button>
          <span className="text-xs text-muted-foreground">or drag and drop</span>
        </div>
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept={typeof acceptAttr === "string" ? acceptAttr : acceptAttr.join(",")}
          multiple={multiple}
          onChange={onSelect}
        />
      </div>

      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="rounded border p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="truncate mr-4">{it.name}</span>
              <span className="capitalize text-muted-foreground">{t(`status.${it.status}` as any)}</span>
            </div>
            {(it.status === "uploading" || it.status === "verifying") && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-muted">
                <div className={"h-full transition-all bg-primary"} style={{ width: `${it.progress}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Uploader;
