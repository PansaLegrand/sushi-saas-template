"use client";

import { useCallback, useEffect, useState } from "react";

import {
  addBlocklistEntry,
  listBlocklist,
  removeBlocklistEntry,
} from "@admin/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { resolveErrorMessage } from "@/lib/errors/client";
import type { BlocklistEntry, BlocklistScope } from "@/types/moderation";

interface Props {
  canWrite: boolean;
}

/**
 * The signup blocklist.
 *
 * The `value` column shows the *normalized* key, which will often not match
 * what was typed — that is the feature working. Plus-suffixes are stripped and
 * Gmail dots are removed, so one rule covers the alias cycling that otherwise
 * defeats an address block entirely.
 */
export default function EmailBlocklistPanel({ canWrite }: Props) {
  const [items, setItems] = useState<BlocklistEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [scope, setScope] = useState<BlocklistScope>("email");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (query?: string) => {
    setLoading(true);
    setError(null);
    try {
      const term = query?.trim() || undefined;
      const result = await listBlocklist(1, 100, term);
      setItems(result.items);
      setTotal(result.total);
      setActiveSearch(term ?? "");
    } catch (e) {
      setError(resolveErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(async () => {
    if (!canWrite || !value.trim()) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addBlocklistEntry({
        scope,
        value: value.trim(),
        reason: reason.trim() || undefined,
        expiresAt: expiresAt || null,
      });

      setNotice(
        result.created
          ? `Blocked ${result.entry.value}`
          : `Already blocked as ${result.entry.value}`,
      );
      setValue("");
      setReason("");
      setExpiresAt("");
      // Back to the unfiltered list: the rule just added is very likely outside
      // whatever filter was on, and an add that appears to have done nothing is
      // how someone adds it twice.
      setSearch("");
      await load();
    } catch (e) {
      setError(resolveErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [canWrite, scope, value, reason, expiresAt, load]);

  const remove = useCallback(
    async (uuid: string) => {
      if (!canWrite) return;
      setLoading(true);
      setError(null);
      setNotice(null);
      try {
        const result = await removeBlocklistEntry(uuid);
        setNotice(`Unblocked ${result.removed.value}`);
        // Stays inside the active filter: an operator lifting rules one at a
        // time is working through a list they just narrowed down.
        await load(activeSearch);
      } catch (e) {
        setError(resolveErrorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [canWrite, load, activeSearch],
  );

  return (
    <div className="space-y-5" aria-busy={loading}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Scope">
          {(field) => (
            <Select
              {...field}
              aria-label="Scope"
              value={scope}
              onChange={(e) =>
                setScope(e.currentTarget.value as BlocklistScope)
              }
            >
              <option value="email">Email address</option>
              <option value="domain">Whole domain</option>
            </Select>
          )}
        </Field>
        <Field label={scope === "domain" ? "Domain" : "Email address"} required>
          {(field) => (
            <Input
              {...field}
              aria-label="Value"
              placeholder={
                scope === "domain" ? "example.com" : "someone@example.com"
              }
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
              required
            />
          )}
        </Field>
        <Field label="Reason">
          {(field) => (
            <Input
              {...field}
              aria-label="Reason"
              placeholder="Why should registration be blocked?"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
          )}
        </Field>
        <Field label="Expires">
          {(field) => (
            <Input
              {...field}
              aria-label="Expires (optional)"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.currentTarget.value)}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="destructive"
          onClick={() => void add()}
          disabled={loading || !canWrite || !value.trim()}
          title={canWrite ? "Add a signup block" : "Read-only admin"}
        >
          {canWrite ? "Block" : "Block disabled (read-only)"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void load(activeSearch)}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </Button>
        <span className="self-center text-sm text-muted-foreground">
          {total} rule{total === 1 ? "" : "s"}
          {activeSearch ? ` matching “${activeSearch}”` : ""}
        </span>
      </div>

      {/* Answers "is this address already blocked?" — the question a flood
          produces hundreds of times and the list alone cannot answer. Paste the
          address as the signup log printed it; the server normalizes before
          matching, so a rule stored under a different-looking key still comes
          back, and a domain rule covering the address does too. */}
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void load(search);
        }}
      >
        <Field
          label="Check an address or domain"
          description="The server checks normalized addresses and matching domain rules."
          className="min-w-0 flex-1"
        >
          {(field) => (
            <Input
              {...field}
              aria-label="Search rules"
              placeholder="Paste an address or domain"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="outline" disabled={loading}>
          Search
        </Button>
        {activeSearch && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSearch("");
              void load();
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert variant="success" role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Table className="min-w-[64rem]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Scope</TableHead>
            {/* The match key, not the input. Differing from "As entered" is
                normalization working, not a bug. */}
            <TableHead>Blocked value</TableHead>
            <TableHead>As entered</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Added</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              {/* An empty result under a search is an answer, not an empty
                  state — say the thing the operator came to find out. */}
              <TableCell className="text-muted-foreground" colSpan={7}>
                {activeSearch
                  ? `No rule blocks “${activeSearch}”. It can register.`
                  : "Nothing blocked."}
              </TableCell>
            </TableRow>
          )}
          {items.map((entry) => (
            <TableRow key={entry.uuid} className="align-top">
              <TableCell>{entry.scope}</TableCell>
              <TableCell className="font-mono">{entry.value}</TableCell>
              <TableCell className="font-mono">
                {entry.originalValue || "—"}
              </TableCell>
              <TableCell>{entry.reason || "—"}</TableCell>
              <TableCell className="whitespace-nowrap font-mono">
                {entry.expiresAt ? entry.expiresAt.slice(0, 10) : "Never"}
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono">
                {entry.createdAt.slice(0, 10)}
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void remove(entry.uuid)}
                  disabled={loading || !canWrite}
                >
                  Unblock
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
