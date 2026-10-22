"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
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
import { ErrorBanner } from "@/components/errors/error-banner";
import { ClientApiError, resolveErrorMessage } from "@/lib/errors/client";
import type { FileObject } from "@/types/storage";

function fmtSize(n: number, locale: string): string {
  if (!Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  while (n >= 1024 && index < units.length - 1) {
    n /= 1024;
    index += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: index ? 1 : 0 }).format(n)} ${units[index]}`;
}

export default function FilesList() {
  const locale = useLocale();
  const t = useTranslations("storage.fileList");
  const [items, setItems] = useState<FileObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<FileObject | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const version = ++requestVersion.current;
      setLoading(true);
      setError(null);
      try {
        const data = await listFiles(signal, page);
        if (!signal.aborted && version === requestVersion.current) {
          setItems(data.items);
          setHasMore(Boolean(data.hasMore));
        }
      } catch (error) {
        if (!signal.aborted && version === requestVersion.current)
          setError(resolveErrorMessage(error, locale));
      } finally {
        if (!signal.aborted && version === requestVersion.current)
          setLoading(false);
      }
    },
    [locale, page],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const onRefresh = () =>
      page === 1 ? void load(controller.signal) : setPage(1);
    window.addEventListener("files:refresh", onRefresh);
    return () => {
      controller.abort();
      window.removeEventListener("files:refresh", onRefresh);
    };
  }, [load, page, retry]);

  async function download(uuid: string) {
    setBusyId(uuid);
    try {
      const { downloadUrl } = await getDownloadUrl(uuid);
      if (!downloadUrl)
        throw new ClientApiError({
          code: "STORAGE_OBJECT_MISSING",
          status: 404,
        });
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(resolveErrorMessage(error, locale));
    } finally {
      setBusyId(null);
    }
  }
  async function confirmDelete() {
    if (!fileToDelete) return;
    setBusyId(fileToDelete.uuid);
    try {
      await deleteFile(fileToDelete.uuid);
      setItems((current) =>
        current.filter((file) => file.uuid !== fileToDelete.uuid),
      );
      setFileToDelete(null);
      if (items.length === 1 && page > 1) setPage(page - 1);
      else setRetry((value) => value + 1);
      toast.success(t("deleted"));
    } catch (error) {
      toast.error(resolveErrorMessage(error, locale));
    } finally {
      setBusyId(null);
    }
  }
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">{t("title")}</h3>
      {errorMessage ? (
        <ErrorBanner
          title={t("loadFailed")}
          message={errorMessage}
          action={
            <Button
              variant="outline"
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("retry")}
            </Button>
          }
        />
      ) : null}
      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-live="polite">
          <span className="sr-only">{t("loading")}</span>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        !errorMessage && (
          <EmptyState
            icon={<FileIcon className="size-6" />}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        )
      ) : (
        <ul className="divide-y rounded-lg border border-border">
          {items.map((file) => (
            <li
              key={file.uuid}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {file.original_filename || t("unnamed")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmtSize(file.size, locale)} ·{" "}
                  {file.created_at
                    ? new Date(String(file.created_at)).toLocaleString(locale)
                    : "—"}{" "}
                  · {t(`status.${file.status}`)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void download(file.uuid)}
                  disabled={Boolean(busyId) || file.status !== "active"}
                >
                  <Download className="mr-1 size-4" />
                  {t("download")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setFileToDelete(file)}
                  disabled={Boolean(busyId)}
                >
                  <Trash2 className="mr-1 size-4" />
                  {t("delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <nav
        aria-label={t("pagination")}
        className="flex items-center justify-between gap-3"
      >
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading || Boolean(busyId)}
          onClick={() => setPage(page - 1)}
        >
          {t("previous")}
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {t("page", { page })}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasMore || loading || Boolean(busyId)}
          onClick={() => setPage(page + 1)}
        >
          {t("next")}
        </Button>
      </nav>
      <Dialog
        open={Boolean(fileToDelete)}
        onOpenChange={(open) => {
          if (!open && !busyId) setFileToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDescription", {
                filename: fileToDelete?.original_filename || t("unnamed"),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={Boolean(busyId)}>
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={Boolean(busyId)}
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
