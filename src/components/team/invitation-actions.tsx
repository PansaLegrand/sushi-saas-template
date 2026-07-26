"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { acceptInvitation, declineInvitation } from "@/api/team";
import { Button } from "@/components/ui/button";
import { resolveErrorMessage } from "@/lib/errors/client";

/**
 * Accept or decline, from the invitation link.
 *
 * The two actions are separate verbs on the server (POST vs DELETE) so a
 * mis-click on decline cannot be replayed by a client into an accept.
 */
export default function InvitationActions({
  id,
  organizationName,
}: {
  id: string;
  organizationName: string;
}) {
  const t = useTranslations("team.invitation");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const act = async (run: () => Promise<unknown>, success: string, to: string) => {
    setBusy(true);
    try {
      await run();
      toast.success(success);
      startTransition(() => router.replace(to));
    } catch (error) {
      toast.error(resolveErrorMessage(error));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        disabled={busy}
        onClick={() =>
          act(
            () => acceptInvitation(id),
            t("accepted", { name: organizationName }),
            `/${locale}/account/team`
          )
        }
      >
        {busy ? t("accepting") : t("accept")}
      </Button>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          act(() => declineInvitation(id), t("declined"), `/${locale}`)
        }
      >
        {t("decline")}
      </Button>
    </div>
  );
}
