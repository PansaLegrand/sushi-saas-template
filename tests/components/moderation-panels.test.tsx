/**
 * The two moderation panels in the admin console.
 *
 * What is worth testing in a form is not that it renders. It is that it tells
 * the operator the truth about what just happened — because the consequential
 * facts here are the counter-intuitive ones, and an admin who does not see them
 * concludes the ban worked when it half did:
 *
 * - one address can hold several accounts, and the ban closed all of them;
 * - leaving the address unblocked means they can register again;
 * - lifting a suspension does not lift a domain rule that still covers them.
 *
 * Also asserted: a read-only admin gets disabled buttons rather than a request
 * that fails at the server. The gate is server-side either way; this is about
 * not inviting someone to press a button that cannot work.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import BanUserPanel from "@admin/components/ban-user";
import EmailBlocklistPanel from "@admin/components/email-blocklist";

const mocks = vi.hoisted(() => ({
  getUserBanState: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  listBlocklist: vi.fn(),
  addBlocklistEntry: vi.fn(),
  removeBlocklistEntry: vi.fn(),
}));

vi.mock("@admin/lib/api", () => ({
  getUserBanState: mocks.getUserBanState,
  banUser: mocks.banUser,
  unbanUser: mocks.unbanUser,
  listBlocklist: mocks.listBlocklist,
  addBlocklistEntry: mocks.addBlocklistEntry,
  removeBlocklistEntry: mocks.removeBlocklistEntry,
}));

const banState = {
  userUuid: "u-1",
  email: "abuser@example.com",
  banned: true,
  bannedAt: "2026-07-28T10:00:00.000Z",
  reason: "signup flood",
  bannedBy: "u-admin",
  activeSessions: 0,
};

function banResult(overrides: Record<string, unknown> = {}) {
  return {
    userUuid: "u-1",
    email: "abuser@example.com",
    applied: true,
    alsoBanned: [],
    sessionsRevoked: 2,
    blocklisted: { uuid: "bl-1", value: "abuser@example.com" },
    state: banState,
    ...overrides,
  };
}

async function typeUuid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("User UUID"), "u-1");
}

describe("BanUserPanel", () => {
  it("offers no writes to a read-only admin", async () => {
    render(<BanUserPanel canWrite={false} />);

    expect(
      screen.getByRole("button", { name: /Suspend disabled/i })
    ).toBeDisabled();
  });

  it("reports the sessions it killed", async () => {
    // The difference between "banned" and "banned, and they are out right now".
    const user = userEvent.setup();
    mocks.banUser.mockResolvedValue(banResult());

    render(<BanUserPanel canWrite />);
    await typeUuid(user);
    await user.click(screen.getByRole("button", { name: "Suspend account" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("2 session(s) revoked");
    });
  });

  it("says when other accounts on the address went down with it", async () => {
    // An admin who does not see this has no idea the ban reached further than
    // the uuid they pasted.
    const user = userEvent.setup();
    mocks.banUser.mockResolvedValue(banResult({ alsoBanned: ["u-2"] }));

    render(<BanUserPanel canWrite />);
    await typeUuid(user);
    await user.click(screen.getByRole("button", { name: "Suspend account" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "1 other account(s) on the same address also suspended"
      );
    });
  });

  it("warns plainly when the address was left open", async () => {
    // The failure mode this exists for: a ban that looks complete while the
    // same person is one OAuth click from a fresh, unbanned account.
    const user = userEvent.setup();
    mocks.banUser.mockResolvedValue(banResult({ blocklisted: null }));

    render(<BanUserPanel canWrite />);
    await typeUuid(user);
    await user.click(screen.getByLabelText(/Also block this email address/i));
    await user.click(screen.getByRole("button", { name: "Suspend account" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /can register again through another provider/i
      );
    });
    expect(mocks.banUser).toHaveBeenCalledWith(
      expect.objectContaining({ blockEmail: false })
    );
  });

  it("blocks the address by default", async () => {
    const user = userEvent.setup();
    mocks.banUser.mockResolvedValue(banResult());

    render(<BanUserPanel canWrite />);
    await typeUuid(user);
    await user.click(screen.getByRole("button", { name: "Suspend account" }));

    expect(mocks.banUser).toHaveBeenCalledWith(
      expect.objectContaining({ blockEmail: true })
    );
  });

  it("says the address is still blocked after a suspension is lifted", async () => {
    // Otherwise the admin sees "not suspended", the user still cannot register,
    // and nobody can explain why.
    const user = userEvent.setup();
    mocks.unbanUser.mockResolvedValue({
      userUuid: "u-1",
      applied: true,
      alsoUnbanned: [],
      remainingBlocklistEntries: [
        { uuid: "bl-2", scope: "domain", value: "example.com" },
      ],
      state: { ...banState, banned: false },
    });

    render(<BanUserPanel canWrite />);
    await typeUuid(user);
    await user.click(screen.getByRole("button", { name: "Lift suspension" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Still blocked from registering by 1 blocklist rule(s)"
      );
    });
  });

  it("asks to lift the address block only on the combined action", async () => {
    const user = userEvent.setup();
    mocks.unbanUser.mockResolvedValue({
      userUuid: "u-1",
      applied: true,
      alsoUnbanned: [],
      remainingBlocklistEntries: [],
      state: { ...banState, banned: false },
    });

    render(<BanUserPanel canWrite />);
    await typeUuid(user);

    await user.click(screen.getByRole("button", { name: "Lift suspension" }));
    expect(mocks.unbanUser).toHaveBeenLastCalledWith({
      userUuid: "u-1",
      removeBlocklistEntry: false,
    });

    await user.click(screen.getByRole("button", { name: "Lift + unblock address" }));
    expect(mocks.unbanUser).toHaveBeenLastCalledWith({
      userUuid: "u-1",
      removeBlocklistEntry: true,
    });
  });

  it("shows a catalogued message rather than raw error text", async () => {
    const user = userEvent.setup();
    mocks.banUser.mockRejectedValue(new Error("connection terminated"));

    render(<BanUserPanel canWrite />);
    await typeUuid(user);
    await user.click(screen.getByRole("button", { name: "Suspend account" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).not.toHaveTextContent("connection terminated");
  });

  it("surfaces live sessions on a suspended account", async () => {
    // Non-zero here means revocation did not take, which is worth seeing rather
    // than assuming.
    mocks.getUserBanState.mockResolvedValue({
      ...banState,
      activeSessions: 3,
      blocklistEntries: [],
    });

    const user = userEvent.setup();
    render(<BanUserPanel canWrite />);
    await typeUuid(user);
    await user.click(screen.getByRole("button", { name: "Load status" }));

    await waitFor(() => {
      expect(screen.getByText("Live sessions")).toBeInTheDocument();
    });
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("EmailBlocklistPanel", () => {
  const entry = {
    uuid: "bl-1",
    scope: "email" as const,
    value: "ann@gmail.com",
    originalValue: "A.N.N+spam@Gmail.com",
    reason: "signup flood",
    createdBy: "u-admin",
    expiresAt: null,
    createdAt: "2026-07-28T10:00:00.000Z",
  };

  it("shows the normalized key beside what was typed", async () => {
    // These differing is the feature working. An operator who only sees their
    // own input cannot tell what is actually being matched.
    mocks.listBlocklist.mockResolvedValue({ items: [entry], total: 1 });

    render(<EmailBlocklistPanel canWrite />);

    await waitFor(() => {
      expect(screen.getByText("ann@gmail.com")).toBeInTheDocument();
    });
    expect(screen.getByText("A.N.N+spam@Gmail.com")).toBeInTheDocument();
  });

  it("says so when a rule was already there", async () => {
    // Re-blocking is a no-op, and silence would read as a new rule added.
    const user = userEvent.setup();
    mocks.listBlocklist.mockResolvedValue({ items: [], total: 0 });
    mocks.addBlocklistEntry.mockResolvedValue({ entry, created: false });

    render(<EmailBlocklistPanel canWrite />);
    await user.type(screen.getByLabelText("Value"), "ann+spam@gmail.com");
    await user.click(screen.getByRole("button", { name: "Block" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Already blocked as ann@gmail.com"
      );
    });
  });

  it("sends the chosen scope", async () => {
    const user = userEvent.setup();
    mocks.listBlocklist.mockResolvedValue({ items: [], total: 0 });
    mocks.addBlocklistEntry.mockResolvedValue({ entry, created: true });

    render(<EmailBlocklistPanel canWrite />);
    await user.selectOptions(screen.getByLabelText("Scope"), "domain");
    await user.type(screen.getByLabelText("Value"), "example.com");
    await user.click(screen.getByRole("button", { name: "Block" }));

    await waitFor(() => {
      expect(mocks.addBlocklistEntry).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "domain", value: "example.com" })
      );
    });
  });

  it("asks the server about an address rather than filtering what it already has", async () => {
    // The rule is stored under a normalized key, so a client-side filter over
    // the loaded page would answer "not blocked" for an address that is.
    const user = userEvent.setup();
    mocks.listBlocklist.mockResolvedValue({ items: [], total: 0 });

    render(<EmailBlocklistPanel canWrite />);
    await user.type(
      screen.getByLabelText("Search rules"),
      "A.N.N+spam@Gmail.com"
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(mocks.listBlocklist).toHaveBeenCalledWith(
        1,
        100,
        "A.N.N+spam@Gmail.com"
      );
    });
  });

  it("says an unmatched address can register, rather than showing an empty table", async () => {
    // The negative is the answer the operator came for, and "Nothing blocked"
    // reads as "the blocklist is empty" instead of "this one is not on it".
    const user = userEvent.setup();
    mocks.listBlocklist.mockResolvedValue({ items: [], total: 0 });

    render(<EmailBlocklistPanel canWrite />);
    await user.type(screen.getByLabelText("Search rules"), "innocent@corp.example");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(
        screen.getByText(/No rule blocks .*innocent@corp\.example.*It can register\./)
      ).toBeInTheDocument();
    });
  });

  it("drops the filter after adding a rule, so the new one is visible", async () => {
    // A rule added while a search is on usually falls outside it. An add that
    // appears to have done nothing is how someone adds it twice.
    const user = userEvent.setup();
    mocks.listBlocklist.mockResolvedValue({ items: [], total: 0 });
    mocks.addBlocklistEntry.mockResolvedValue({ entry, created: true });

    render(<EmailBlocklistPanel canWrite />);
    await user.type(screen.getByLabelText("Search rules"), "corp.example");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(mocks.listBlocklist).toHaveBeenCalledWith(1, 100, "corp.example");
    });

    mocks.listBlocklist.mockClear();
    await user.type(screen.getByLabelText("Value"), "other@example.com");
    await user.click(screen.getByRole("button", { name: "Block" }));

    await waitFor(() => {
      expect(mocks.listBlocklist).toHaveBeenCalledWith(1, 100, undefined);
    });
  });

  it("reloads after a rule is lifted", async () => {
    // A stale table after an unblock is how someone removes the same rule twice
    // and concludes it is stuck.
    const user = userEvent.setup();
    mocks.listBlocklist.mockResolvedValue({ items: [entry], total: 1 });
    mocks.removeBlocklistEntry.mockResolvedValue({ removed: entry });

    render(<EmailBlocklistPanel canWrite />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unblock" })).toBeInTheDocument();
    });

    mocks.listBlocklist.mockClear();
    await user.click(screen.getByRole("button", { name: "Unblock" }));

    await waitFor(() => {
      expect(mocks.listBlocklist).toHaveBeenCalled();
    });
  });

  it("offers no writes to a read-only admin", async () => {
    mocks.listBlocklist.mockResolvedValue({ items: [entry], total: 1 });

    render(<EmailBlocklistPanel canWrite={false} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unblock" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: /Block disabled/i })).toBeDisabled();
  });
});
