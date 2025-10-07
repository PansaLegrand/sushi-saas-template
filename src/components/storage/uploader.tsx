"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

type UploadItem = {
  id: string;
  name: string;
  size: number;
  status: "pending" | "uploading" | "verifying" | "done" | "error";
  progress: number;
  downloadUrl?: string;
};

function uploadViaFetch(url: string, headers: Record<string, string> | undefined, file: File): Promise<Response> {
  return fetch(url, { method: "PUT", headers: { ...(headers || {}), "Content-Type": file.type }, body: file });
}

export function Uploader() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const t = useTranslations("storage");

  async function createUpload(file: File) {
    const res = await fetch("/api/storage/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
    });
    if (!res.ok) throw new Error(t("errorCreate"));
    return (await res.json()).data as {
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
    if (!res.ok) throw new Error(t("errorComplete"));
    return (await res.json()).data as any;
  }

  const onSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const next: UploadItem[] = [];
    for (const f of Array.from(files)) {
      next.push({ id: Math.random().toString(36).slice(2), name: f.name, size: f.size, status: "pending", progress: 0 });
    }
    setItems((prev) => [...next, ...prev]);

    for (const f of Array.from(files)) {
      const tempId = Math.random().toString(36).slice(2);
      try {
        const created = await createUpload(f);
        setItems((prev) => prev.map((it) => (it.name === f.name && it.status === "pending" ? { ...it, id: created.fileUuid, status: "uploading" } : it)));
        const res = await uploadViaFetch(created.uploadUrl, created.headers, f);
        if (!res.ok) throw new Error(`upload failed: ${res.status}`);
        setItems((prev) => prev.map((it) => (it.id === created.fileUuid ? { ...it, status: "verifying", progress: 100 } : it)));
        await completeUpload(created.fileUuid);
        setItems((prev) => prev.map((it) => (it.id === created.fileUuid ? { ...it, status: "done" } : it)));
      } catch (err: any) {
        console.error(err);
        toast.error(err?.message || t("errorUpload"));
        setItems((prev) => prev.map((it) => (it.name === f.name && (it.status === "pending" || it.status === "uploading" || it.status === "verifying") ? { ...it, status: "error" } : it)));
      }
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded border p-4">
        <label className="block text-sm font-medium mb-2">{t("uploadLabel")}</label>
        <input type="file" multiple onChange={onSelect} />
        <p className="text-xs text-muted-foreground mt-2">{t("hintPrivate", { mb: Number(process.env.NEXT_PUBLIC_UPLOAD_MAX_MB) || 25 })}</p>
      </div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <span className="truncate mr-4">{it.name}</span>
            <span className="capitalize">{t(`status.${it.status}` as any)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Uploader;
