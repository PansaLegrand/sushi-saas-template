"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { FileObject } from "@/types/storage";

function fmtSize(n: number): string {
  if (!Number.isFinite(n)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function FilesList() {
  const [items, setItems] = useState<FileObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/storage/files");
      if (!res.ok) throw new Error("Failed to load files");
      const json = await res.json();
      setItems(json.data?.items || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener("files:refresh", onRefresh);
    return () => window.removeEventListener("files:refresh", onRefresh);
  }, [load]);

  const hasItems = useMemo(() => items && items.length > 0, [items]);

  const onDownload = useCallback(async (uuid: string) => {
    setBusyId(uuid);
    try {
      const res = await fetch(`/api/storage/files/${uuid}?download=1`);
      if (!res.ok) throw new Error("Failed to get download URL");
      const json = await res.json();
      const url: string | undefined = json.data?.downloadUrl;
      if (!url) throw new Error("No download URL");
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e?.message || "Download failed");
    } finally {
      setBusyId(null);
    }
  }, []);

  const onDelete = useCallback(async (uuid: string) => {
    const ok = window.confirm("Delete this file? This cannot be undone.");
    if (!ok) return;
    setBusyId(uuid);
    try {
      const res = await fetch(`/api/storage/files/${uuid}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setItems((prev) => prev.filter((it) => it.uuid !== uuid));
      toast.success("Deleted");
    } catch (e: any) {
      toast.error(e?.message || "Delete failed");
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Your Files</h3>
      {loading ? (
        <div className="rounded border p-4 text-sm text-muted-foreground">Loading…</div>
      ) : !hasItems ? (
        <div className="rounded border p-6 text-center text-sm text-muted-foreground">No files yet.</div>
      ) : (
        <ul className="divide-y rounded border">
          {items.map((f) => (
            <li key={f.uuid} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{f.original_filename || f.key}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fmtSize(f.size)} • {new Date(f.created_at as any).toLocaleString()} • {f.status}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onDownload(f.uuid)}
                  disabled={busyId === f.uuid || f.status !== "active"}
                >
                  <Download className="mr-1 h-4 w-4" /> Download
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onDelete(f.uuid)}
                  disabled={busyId === f.uuid}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

