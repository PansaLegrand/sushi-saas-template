"use client";

import { useCallback, useEffect, useState } from "react";

import {
  addBlocklistEntry,
  listBlocklist,
  removeBlocklistEntry,
} from "@admin/lib/api";
import { Input } from "@/components/ui/input";
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
          : `Already blocked as ${result.entry.value}`
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
    [canWrite, load, activeSearch]
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <select
          aria-label="Scope"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={scope}
          onChange={(e) => setScope(e.currentTarget.value as BlocklistScope)}
        >
          <option value="email">Address</option>
          <option value="domain">Whole domain</option>
        </select>
        <Input
          aria-label="Value"
          placeholder={scope === "domain" ? "example.com" : "someone@example.com"}
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
        />
        <Input
          aria-label="Reason"
          placeholder="Reason (audit log)"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <Input
          aria-label="Expires (optional)"
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.currentTarget.value)}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          className="inline-flex items-center rounded bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-50"
          onClick={() => void add()}
          disabled={loading || !canWrite || !value.trim()}
          title={canWrite ? "Add a signup block" : "Read-only admin"}
        >
          {canWrite ? "Block" : "Block disabled (read-only)"}
        </button>
        <button
          className="inline-flex items-center rounded border px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => void load(activeSearch)}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
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
        className="flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void load(search);
        }}
      >
        <Input
          aria-label="Search rules"
          placeholder="Is this blocked? Paste an address or domain"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <button
          type="submit"
          className="inline-flex items-center rounded border px-3 py-2 text-sm disabled:opacity-50"
          disabled={loading}
        >
          Search
        </button>
        {activeSearch && (
          <button
            type="button"
            className="self-center text-sm text-muted-foreground underline"
            onClick={() => {
              setSearch("");
              void load();
            }}
          >
            Clear
          </button>
        )}
      </form>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 pr-4">Scope</th>
              {/* The match key, not the input. Differing from "As entered" is
                  normalization working, not a bug. */}
              <th className="py-2 pr-4">Blocked value</th>
              <th className="py-2 pr-4">As entered</th>
              <th className="py-2 pr-4">Reason</th>
              <th className="py-2 pr-4">Expires</th>
              <th className="py-2 pr-4">Added</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                {/* An empty result under a search is an answer, not an empty
                    state — say the thing the operator came to find out. */}
                <td className="py-3 text-muted-foreground" colSpan={7}>
                  {activeSearch
                    ? `No rule blocks “${activeSearch}”. It can register.`
                    : "Nothing blocked."}
                </td>
              </tr>
            )}
            {items.map((entry) => (
              <tr key={entry.uuid} className="border-t align-top">
                <td className="py-2 pr-4">{entry.scope}</td>
                <td className="py-2 pr-4 font-mono text-xs">{entry.value}</td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {entry.originalValue || "—"}
                </td>
                <td className="py-2 pr-4">{entry.reason || "—"}</td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {entry.expiresAt ? entry.expiresAt.slice(0, 10) : "never"}
                </td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {entry.createdAt.slice(0, 10)}
                </td>
                <td className="py-2 pr-4">
                  <button
                    className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() => void remove(entry.uuid)}
                    disabled={loading || !canWrite}
                  >
                    Unblock
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
