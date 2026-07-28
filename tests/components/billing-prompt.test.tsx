/**
 * The upsell dialog, rendered against the real `messages/en.json`.
 *
 * Deliberately not a stubbed translator like `uploader.test.tsx` uses. Half of
 * what can go wrong here is the copy itself: a key that exists in the component
 * and not in the messages file, or an ICU plural that formats "1 more credits".
 * A stub that echoes keys back passes both of those. So this mounts the real
 * provider and asserts on sentences a user would read.
 *
 * The other half is the hook's contract with the page: `prompt` must tell the
 * caller whether it took ownership, and dismissing the dialog must not erase
 * the fact that the user is blocked.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../messages/en.json";
import { BillingPromptDialog } from "@/components/billing/billing-prompt-dialog";
import { useBillingPrompt } from "@/components/billing/use-billing-prompt";
import { ClientApiError } from "@/lib/errors/client";

// The locale-aware Link needs Next's router context, which is not what these
// tests are about. An anchor keeps `href` assertable.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function apiError(code: string, details?: unknown) {
  return new ClientApiError({
    code: code as never,
    status: 400,
    message: "org 4f2 has insufficient credits for 10",
    details,
  });
}

/** A page in miniature: a failing action, the hook, and the dialog. */
function Harness({ error }: { error: unknown }) {
  const { prompt, block, dialogProps } = useBillingPrompt();
  const [handled, setHandled] = useState<boolean | null>(null);

  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <button onClick={() => setHandled(prompt(error))}>Run task</button>
      {handled !== null ? <p>handled: {String(handled)}</p> : null}
      {block ? <p>still blocked</p> : null}
      <BillingPromptDialog {...dialogProps} />
    </NextIntlClientProvider>
  );
}

async function run(error: unknown) {
  const user = userEvent.setup();
  render(<Harness error={error} />);
  await user.click(screen.getByText("Run task"));
  return user;
}

describe("BillingPromptDialog", () => {
  it("stays closed until something is refused", () => {
    render(<Harness error={apiError("CREDITS_INSUFFICIENT")} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("tells the user exactly how many credits are missing", async () => {
    await run(apiError("CREDITS_INSUFFICIENT", { required: 10, available: 6 }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName(/out of credits/i);
    expect(dialog).toHaveTextContent("You need 4 more credits to run this.");
    expect(dialog).toHaveTextContent("Your balance is 6 credits.");
  });

  it("gets the singular right", async () => {
    await run(apiError("CREDITS_INSUFFICIENT", { required: 10, available: 9 }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("You need 1 more credit to run this.");
    // ...and not the plural form the naive template would produce.
    expect(dialog).not.toHaveTextContent("1 more credits");
  });

  it("falls back to a complete sentence when the server sent no numbers", async () => {
    await run(apiError("CREDITS_INSUFFICIENT"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/costs more credits than you have left/i);
    expect(dialog.textContent).not.toMatch(/undefined|NaN|\{/);
  });

  it("names the tier that unlocks a gated feature", async () => {
    await run(
      apiError("PLAN_UPGRADE_REQUIRED", {
        feature: "tasks.text_to_video",
        tier: "free",
        requiredTier: "plus",
      })
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName(/not included in your plan/i);
    expect(dialog).toHaveTextContent("This feature is available on Plus and above.");
  });

  it("renders a tier it has no translation for rather than a key", async () => {
    await run(apiError("PLAN_UPGRADE_REQUIRED", { requiredTier: "team" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("available on team and above");
    expect(dialog.textContent).not.toContain("tiers.team");
  });

  it("explains a limit differently from a missing feature", async () => {
    await run(apiError("PLAN_LIMIT_EXCEEDED", { limit: "storage.totalMb", requiredTier: "max" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName(/reached your plan/i);
    expect(dialog).toHaveTextContent("Upgrading to Max raises this limit.");
  });

  it("offers a way to pay and a way to leave", async () => {
    await run(apiError("CREDITS_INSUFFICIENT", { required: 10, available: 6 }));

    await screen.findByRole("dialog");
    expect(screen.getByRole("link", { name: "View plans" })).toHaveAttribute(
      "href",
      "/pricing"
    );
    expect(screen.getByRole("link", { name: "Manage billing" })).toHaveAttribute(
      "href",
      "/account/billing"
    );
    expect(screen.getByText("Not now")).toBeInTheDocument();
  });

  it("never puts the server's own words on screen", async () => {
    await run(apiError("CREDITS_INSUFFICIENT", { required: 10, available: 6 }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).not.toContain("org 4f2");
    expect(dialog.textContent).not.toContain("insufficient credits for");
  });
});

describe("useBillingPrompt", () => {
  it("reports that it handled a billing failure", async () => {
    await run(apiError("CREDITS_INSUFFICIENT"));
    expect(screen.getByText("handled: true")).toBeInTheDocument();
  });

  it("declines anything else, leaving the page to report it", async () => {
    await run(apiError("SERVER_ERROR"));

    expect(screen.getByText("handled: false")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the block after the dialog is dismissed", async () => {
    // The page uses this to keep a pricing link in the banner. Losing it on
    // close would strand a user who closed the modal to re-read the form.
    const user = await run(apiError("CREDITS_INSUFFICIENT", { required: 10, available: 6 }));

    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("still blocked")).toBeInTheDocument();
  });
});
