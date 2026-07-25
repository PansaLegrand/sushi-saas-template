"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "next-intl";

import { ensureInviteCode as requestInviteCode } from "@/api/affiliate";
import { Button } from "@/components/ui/button";
import { resolveErrorMessage } from "@/lib/errors/client";

interface Props {
  initialInviteCode?: string;
  initialShareUrl?: string;
}

export default function InviteLink({ initialInviteCode, initialShareUrl }: Props) {
  const [inviteCode, setInviteCode] = useState<string | undefined>(
    initialInviteCode && initialInviteCode.length > 0 ? initialInviteCode : undefined
  );
  const [shareUrl, setShareUrl] = useState<string | undefined>(
    initialShareUrl && initialShareUrl.length > 0 ? initialShareUrl : undefined
  );
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const disabled = useMemo(() => busy, [busy]);
  const locale = useLocale();

  const ensureInviteCode = useCallback(
    async (regenerate = false) => {
      setBusy(true);
      try {
        const data = await requestInviteCode({ regenerate });
        setInviteCode(data?.inviteCode);
        setShareUrl(data?.shareUrl);
      } catch (error) {
        // Previously swallowed on any non-OK response, which left the label
        // stuck on "Generating..." with no indication anything had failed.
        toast.error(resolveErrorMessage(error, locale));
      } finally {
        setBusy(false);
      }
    },
    [locale]
  );

  useEffect(() => {
    if (!inviteCode) {
      // Generate on first mount if missing
      void ensureInviteCode(false);
    }
    // Runs once: regenerating on every ensureInviteCode identity change would
    // issue a fresh code each render pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <code className="rounded border bg-muted px-2 py-1 text-sm">
          {shareUrl ?? "Generating..."}
        </code>
        <Button size="sm" variant="secondary" onClick={copy} disabled={!shareUrl}>
          <Copy className="mr-1 h-4 w-4" /> {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void ensureInviteCode(true)} disabled={disabled}>
          {busy ? "Working..." : "Regenerate"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Share this link to attribute new signups and purchases to you.
      </p>
    </div>
  );
}

