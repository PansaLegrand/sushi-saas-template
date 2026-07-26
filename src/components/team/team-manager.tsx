"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserMinus } from "lucide-react";

import {
  cancelInvitation,
  changeMemberRole,
  inviteMember,
  removeMember,
} from "@/api/team";
import { Badge } from "@/components/ui/badge";
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
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveErrorMessage } from "@/lib/errors/client";
import type { MemberView, OrgRoleName, TeamView } from "@/types/team";

/**
 * The team screen.
 *
 * Server-rendered once and handed in as `initial`, then re-rendered from
 * whatever each mutation returns. Every write endpoint answers with the whole
 * team rather than a delta, so the client never has to guess what a change did
 * to the rest of the list — which is where optimistic updates usually go wrong
 * (a promotion that also demotes someone, a removal that was refused).
 */
export default function TeamManager({ initial }: { initial: TeamView }) {
  const t = useTranslations("team");
  const locale = useLocale();
  const router = useRouter();
  const [team, setTeam] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const formatDate = useCallback(
    (iso: string | null) =>
      iso ? new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" }) : "",
    [locale]
  );

  /** One place for the shared shape: mark busy, call, replace, report. */
  const run = useCallback(
    async (key: string, action: () => Promise<TeamView | null>, success?: string) => {
      setBusy(key);
      try {
        const next = await action();
        if (next) setTeam(next);
        if (success) toast.success(success);
      } catch (error) {
        // Never the raw message: it is backend English and would appear
        // untranslated in whichever locale the user is not reading.
        toast.error(resolveErrorMessage(error));
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const roleLabel = (role: string) =>
    t(`roles.${role}` as "roles.owner", { fallback: role } as never) || role;

  return (
    <div className="space-y-8">
      {/* Derived from the actual membership, not the stored `is_personal`
          flag: a workspace someone has been invited into keeps that flag but
          is plainly no longer personal. */}
      {team.members.length === 1 && team.invitations.length === 0 ? (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {t("personalNotice")}
        </p>
      ) : null}

      {team.viewer.canManage ? (
        <InviteForm
          busy={busy === "invite"}
          canAssignOwner={team.viewer.role === "owner"}
          onInvite={(email, role) =>
            run("invite", () => inviteMember(email, role), t("inviteSent", { email }))
          }
        />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t("membersHeading")}
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {team.members.map((member) => (
            <MemberRow
              key={member.memberId}
              member={member}
              team={team}
              busy={busy === member.memberId}
              formatDate={formatDate}
              roleLabel={roleLabel}
              onRoleChange={(role) =>
                run(
                  member.memberId,
                  () => changeMemberRole(member.memberId, role),
                  t("roleChanged", { name: member.name, role: roleLabel(role) })
                )
              }
              onRemove={() =>
                run(member.memberId, async () => {
                  const result = await removeMember(member.memberId);

                  if (result && "left" in result) {
                    toast.success(t("left"));
                    // The caller is no longer in this organization, so there is
                    // nothing left on this screen to re-render.
                    startTransition(() => router.replace(`/${locale}/account/billing`));
                    return null;
                  }

                  toast.success(t("removed", { name: member.name }));
                  return result as TeamView;
                })
              }
            />
          ))}
        </ul>
      </section>

      {team.viewer.canManage ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("invitationsHeading")}
          </h2>
          {team.invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noInvitations")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {team.invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {invitation.role ? `${roleLabel(invitation.role)} · ` : ""}
                      {t("expires", { date: formatDate(invitation.expiresAt) })}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === invitation.id}
                    onClick={() =>
                      run(
                        invitation.id,
                        () => cancelInvitation(invitation.id),
                        t("invitationCanceled")
                      )
                    }
                  >
                    {t("cancelInvitation")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function InviteForm({
  busy,
  canAssignOwner,
  onInvite,
}: {
  busy: boolean;
  canAssignOwner: boolean;
  onInvite: (email: string, role: string) => void;
}) {
  const t = useTranslations("team");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRoleName>("member");

  // An admin cannot mint an owner. The server enforces this too — the option is
  // hidden so the UI does not offer an action that will be refused.
  const roles: OrgRoleName[] = canAssignOwner
    ? ["owner", "admin", "member"]
    : ["admin", "member"];

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!email.trim()) return;
        onInvite(email.trim().toLowerCase(), role);
        setEmail("");
      }}
    >
      <Field className="min-w-[16rem] flex-1" label={t("inviteEmailLabel")} required>
        {(field) => (
          <Input
            {...field}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            required
          />
        )}
      </Field>

      <div className="space-y-2">
        <Label htmlFor="invite-role">{t("inviteRoleLabel")}</Label>
        <select
          id="invite-role"
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          value={role}
          onChange={(event) => setRole(event.currentTarget.value as OrgRoleName)}
        >
          {roles.map((value) => (
            <option key={value} value={value}>
              {t(`roles.${value}` as "roles.owner")}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" disabled={busy}>
        {busy ? t("inviteSending") : t("inviteSubmit")}
      </Button>
    </form>
  );
}

function MemberRow({
  member,
  team,
  busy,
  formatDate,
  roleLabel,
  onRoleChange,
  onRemove,
}: {
  member: MemberView;
  team: TeamView;
  busy: boolean;
  formatDate: (iso: string | null) => string;
  roleLabel: (role: string) => string;
  onRoleChange: (role: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("team");
  const [confirming, setConfirming] = useState(false);

  const isOnlyOwner =
    member.role === "owner" &&
    team.members.filter((row) => row.role === "owner").length === 1;

  // Leaving is always your own choice; removing someone else needs the
  // permission. A personal workspace has neither, since it cannot be emptied.
  // Leaving is your own choice; removing someone else needs the permission.
  // The last owner can be neither removed nor demoted, so the control is hidden
  // rather than offered and refused.
  const canRemove = !isOnlyOwner && (member.isSelf || team.viewer.canManage);

  const canChangeRole =
    team.viewer.canManage && !member.isSelf && !isOnlyOwner;

  const assignable: OrgRoleName[] =
    team.viewer.role === "owner" ? ["owner", "admin", "member"] : ["admin", "member"];

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {member.name}
          {member.isSelf ? (
            <Badge variant="secondary" className="ml-2 align-middle">
              {t("you")}
            </Badge>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {member.email}
          {member.joinedAt ? ` · ${t("joined", { date: formatDate(member.joinedAt) })}` : ""}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {canChangeRole ? (
          <select
            aria-label={t("inviteRoleLabel")}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={member.role}
            disabled={busy}
            onChange={(event) => onRoleChange(event.currentTarget.value)}
          >
            {assignable.map((value) => (
              <option key={value} value={value}>
                {t(`roles.${value}` as "roles.owner")}
              </option>
            ))}
          </select>
        ) : (
          <Badge variant="outline">{roleLabel(member.role)}</Badge>
        )}

        {canRemove ? (
          <Dialog open={confirming} onOpenChange={setConfirming}>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={member.isSelf ? t("leave") : t("remove")}
              onClick={() => setConfirming(true)}
            >
              <UserMinus className="size-4" />
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {member.isSelf
                    ? t("leaveConfirmTitle", { name: team.organization.name })
                    : t("removeConfirmTitle", { name: member.name })}
                </DialogTitle>
                <DialogDescription>
                  {member.isSelf ? t("leaveConfirmBody") : t("removeConfirmBody")}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t("cancel")}</Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    onRemove();
                  }}
                >
                  {member.isSelf ? t("leaveConfirm") : t("removeConfirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </li>
  );
}
