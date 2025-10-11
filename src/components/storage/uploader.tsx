"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { UploadCloud } from "lucide-react";

type UploadItem = {
  id: string;
  name: string;
  size: number;
  status: "pending" | "uploading" | "verifying" | "done" | "error";
  progress: number;
  downloadUrl?: string;
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

export function Uploader() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const t = useTranslations("storage");

  async function createUpload(file: File) {
    const res = await fetch("/api/storage/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream", size: file.size }),
    });
    const json = await res.json().catch(() => null as any);
    if (!res.ok || !json || json.code !== 0) {
      const msg = (json && json.message) || t("errorCreate");
      throw new Error(msg);
    }
    return json.data as {
      fileUuid: string;
      uploadUrl: string;
      method: "PUT";
      headers?: Record<string, string>;
    };
  }

  async function completeUpload(fileUuid: string) {
    const res = await fetch("/api/storage/uploads/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUuid }),
    });
    const json = await res.json().catch(() => null as any);
    if (!res.ok || !json || json.code !== 0) {
      const msg = (json && json.message) || t("errorComplete");
      throw new Error(msg);
    }
    return json.data as any;
  }

  const queueFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: UploadItem[] = [];
    for (const f of Array.from(files)) {
      next.push({ id: Math.random().toString(36).slice(2), name: f.name, size: f.size, status: "pending", progress: 0 });
    }
    setItems((prev) => [...next, ...prev]);

    (async () => {
      for (const f of Array.from(files)) {
        try {
          const created = await createUpload(f);
          setItems((prev) =>
            prev.map((it) => (it.name === f.name && it.status === "pending" ? { ...it, id: created.fileUuid, status: "uploading" } : it))
          );

          const res = await uploadViaXHR(created.uploadUrl, created.headers, f, (pct) => {
            setItems((prev) => prev.map((it) => (it.id === created.fileUuid ? { ...it, progress: pct } : it)));
          });

          if (!res.ok) throw new Error(`upload failed: ${res.status}`);
          setItems((prev) => prev.map((it) => (it.id === created.fileUuid ? { ...it, status: "verifying", progress: 100 } : it)));
          await completeUpload(created.fileUuid);
          setItems((prev) => prev.map((it) => (it.id === created.fileUuid ? { ...it, status: "done" } : it)));
          toast.success(t("status.done" as any));
          // notify other components (e.g., FilesList) to refresh
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("files:refresh"));
          }
        } catch (err: any) {
          console.error(err);
          toast.error(err?.message || t("errorUpload"));
          setItems((prev) =>
            prev.map((it) =>
              it.name === f.name && (it.status === "pending" || it.status === "uploading" || it.status === "verifying")
                ? { ...it, status: "error" }
                : it
            )
          );
        }
      }
    })();
  }, [t]);

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

  const maxMb = Number(process.env.NEXT_PUBLIC_UPLOAD_MAX_MB) || 25;

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
          <p className="text-sm font-medium">{t("uploadLabel")}</p>
          <p className="text-xs text-muted-foreground">{t("hintPrivate", { mb: maxMb })}</p>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
            Browse files
          </Button>
          <span className="text-xs text-muted-foreground">or drag and drop</span>
        </div>
        <input ref={fileInputRef} className="hidden" type="file" multiple onChange={onSelect} />
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
