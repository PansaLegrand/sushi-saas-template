/**
 * The two-factor panel's provider-only branch and authenticator setup contract.
 *
 * The bug this covers: an account created through Google has no password, so
 * the panel's "confirm your password" prompt was unanswerable — every input
 * came back `INVALID_PASSWORD`, which reads as a typo. Because admin roles
 * cannot open the console until two-factor auth is on, a Google-only admin was
 * stuck with no way forward from inside the app.
 * The real auth client also distinguishes authenticator setup from OTP-only
 * responses; accepting the latter as QR data would break setup rendering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TwoFactorSetupPanel } from "@/components/auth/two-factor-setup-panel";
import { resolveAuthError } from "@/lib/errors/auth-client";

// Better Auth captures fetch when its client is created during module import.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", mock);
  return mock;
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TwoFactorSetupPanel", () => {
  it("asks a password-holding account to confirm its password", async () => {
    render(<TwoFactorSetupPanel initialEnabled={false} initialHasPassword />);

    expect(
      screen.getByRole("button", { name: "Enable two-factor" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Set a password first")).not.toBeInTheDocument();
  });

  it("offers to create one when the account has none", async () => {
    render(
      <TwoFactorSetupPanel
        initialEnabled={false}
        initialHasPassword={false}
        providers={["google"]}
      />
    );

    expect(screen.getByText("Set a password first")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Set password" })
    ).toBeInTheDocument();
    // The dead end: a prompt for a password that does not exist.
    expect(
      screen.queryByRole("button", { name: "Enable two-factor" })
    ).not.toBeInTheDocument();
  });

  it("names the provider the account actually uses", async () => {
    render(
      <TwoFactorSetupPanel
        initialEnabled={false}
        initialHasPassword={false}
        providers={["google"]}
      />
    );

    expect(screen.getAllByText("google").length).toBeGreaterThan(0);
  });

  it("falls back to neutral wording when no provider is known", async () => {
    // Rendering "You signed up with ." would look like a bug to the one person
    // least able to tell whether it is one.
    render(
      <TwoFactorSetupPanel initialEnabled={false} initialHasPassword={false} />
    );

    expect(screen.getByText(/a sign-in provider/)).toBeInTheDocument();
  });

  it("moves on to two-factor setup once a password is set", async () => {
    // The whole point: one form flows into the next without a reload, so the
    // user is not left guessing whether it worked.
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      Response.json({ code: 0, data: { ok: true } }),
    );

    render(
      <TwoFactorSetupPanel
        initialEnabled={false}
        initialHasPassword={false}
        providers={["google"]}
      />
    );

    await user.type(screen.getByLabelText(/New password/), "a-good-password");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Enable two-factor" })
      ).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ newPassword: "a-good-password" }),
      }),
    );
  });

  it("keeps the form open and shows catalogued copy when setting fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error("connection lost"));

    render(
      <TwoFactorSetupPanel initialEnabled={false} initialHasPassword={false} />
    );

    await user.type(screen.getByLabelText(/New password/), "a-good-password");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).not.toHaveTextContent("connection lost");
    expect(
      screen.getByRole("button", { name: "Set password" })
    ).toBeInTheDocument();
  });

  it("shows the disable form when two-factor is already on", async () => {
    render(<TwoFactorSetupPanel initialEnabled initialHasPassword />);

    expect(
      screen.getByRole("button", { name: "Disable two-factor" })
    ).toBeInTheDocument();
  });

  it("requests authenticator setup and displays its QR and backup codes", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      Response.json({
        method: "totp",
        totpURI: "otpauth://totp/Example?secret=OBZW4ZSEKUZW63LUIQYQ",
        backupCodes: ["aaaa1-bbbb2", "cccc3-dddd4"],
      }),
    );
    render(<TwoFactorSetupPanel initialEnabled={false} initialHasPassword />);

    await user.type(screen.getByLabelText(/Password/), "a-good-password");
    await user.click(screen.getByRole("button", { name: "Enable two-factor" }));

    expect(await screen.findByRole("img", { name: /QR code/i })).toBeInTheDocument();
    expect(screen.getByText("aaaa1-bbbb2")).toBeInTheDocument();
    expect(screen.getByText("cccc3-dddd4")).toBeInTheDocument();
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/auth/two-factor/enable");
    expect(JSON.parse(String(options?.body))).toEqual({
      password: "a-good-password",
      method: "totp",
    });
  });

  it("keeps setup available with catalogued copy for an unexpected OTP response", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ method: "otp" }));
    render(<TwoFactorSetupPanel initialEnabled={false} initialHasPassword />);

    await user.type(screen.getByLabelText(/Password/), "a-good-password");
    await user.click(screen.getByRole("button", { name: "Enable two-factor" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(resolveAuthError(null));
    expect(screen.queryByRole("img", { name: /QR code/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable two-factor" })).toBeEnabled();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });
});
