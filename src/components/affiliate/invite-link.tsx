"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";

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

  async function ensureInviteCode(regen = false) {
    setBusy(true);
    try {
      const res = await fetch(`/api/affiliate/invite-code${regen ? "?regen=1" : ""}`, {
        method: "POST",
      });
      if (!res.ok) return;
      const json = await res.json();
      const data = json?.data ?? {};
      setInviteCode(data.inviteCode);
      setShareUrl(data.shareUrl);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!inviteCode) {
      // Generate on first mount if missing
      ensureInviteCode(false);
    }
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
        <Button size="sm" variant="outline" onClick={() => ensureInviteCode(true)} disabled={disabled}>
          {busy ? "Working..." : "Regenerate"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Share this link to attribute new signups and purchases to you.
      </p>
    </div>
  );
}

