"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "next-intl";

import { deleteFile, getDownloadUrl, listFiles } from "@/api/storage";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveErrorMessage } from "@/lib/errors/client";
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
  const locale = useLocale();
  const [items, setItems] = useState<FileObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<FileObject | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listFiles();
      setItems(data?.items ?? []);
    } catch (error) {
      toast.error(resolveErrorMessage(error, locale));
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener("files:refresh", onRefresh);
    return () => window.removeEventListener("files:refresh", onRefresh);
  }, [load]);

  const onDownload = useCallback(
    async (uuid: string) => {
      setBusyId(uuid);
      try {
        const { downloadUrl } = await getDownloadUrl(uuid);
        // A 200 with no URL is a server bug, not something the user can act on.
        // The catalogued code keeps the message translated and non-technical.
        if (!downloadUrl) throw new Error("STORAGE_OBJECT_MISSING");
        window.open(downloadUrl, "_blank");
      } catch (error) {
        toast.error(resolveErrorMessage(error, locale));
      } finally {
        setBusyId(null);
      }
    },
    [locale]
  );

  const onConfirmDelete = useCallback(
    async () => {
      const uuid = fileToDelete?.uuid;
      if (!uuid) return;

      setBusyId(uuid);
      try {
        await deleteFile(uuid);
        setItems((prev) => prev.filter((it) => it.uuid !== uuid));
        setFileToDelete(null);
        toast.success("Deleted");
      } catch (error) {
        toast.error(resolveErrorMessage(error, locale));
      } finally {
        setBusyId(null);
      }
    },
    [fileToDelete?.uuid, locale]
  );

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Your Files</h3>

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading files…</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileIcon className="h-6 w-6" />}
          title="No files yet"
          description="Files you upload will appear here."
        />
      ) : (
        <ul className="divide-y rounded border">
          {items.map((f) => (
            <li
              key={f.uuid}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {f.original_filename || f.key}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fmtSize(f.size)} • {new Date(f.created_at as any).toLocaleString()} •{" "}
                  {f.status}
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
                  onClick={() => setFileToDelete(f)}
                  disabled={busyId === f.uuid}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={!!fileToDelete}
        onOpenChange={(open) => {
          if (!open && !busyId) setFileToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete file?</DialogTitle>
            <DialogDescription>
              This will remove{" "}
              <span className="font-medium text-foreground">
                {fileToDelete?.original_filename || fileToDelete?.key || "this file"}
              </span>
              . This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={!!busyId}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={onConfirmDelete}
              disabled={!!busyId}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
