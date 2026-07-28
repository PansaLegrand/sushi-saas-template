/**
 * The two-factor panel's provider-only branch.
 *
 * The bug this covers: an account created through Google has no password, so
 * the panel's "confirm your password" prompt was unanswerable — every input
 * came back `INVALID_PASSWORD`, which reads as a typo. Because admin roles
 * cannot open the console until two-factor auth is on, a Google-only admin was
 * stuck with no way forward from inside the app.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TwoFactorSetupPanel } from "@/components/auth/two-factor-setup-panel";

const mocks = vi.hoisted(() => ({
  setAccountPassword: vi.fn(),
  enable: vi.fn(),
}));

vi.mock("@/api/account", () => ({
  setAccountPassword: mocks.setAccountPassword,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    twoFactor: {
      enable: mocks.enable,
      verifyTotp: vi.fn(),
      disable: vi.fn(),
    },
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
}));

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
    mocks.setAccountPassword.mockResolvedValue({ ok: true });

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
    expect(mocks.setAccountPassword).toHaveBeenCalledWith("a-good-password");
  });

  it("keeps the form open and shows catalogued copy when setting fails", async () => {
    const user = userEvent.setup();
    mocks.setAccountPassword.mockRejectedValue(new Error("connection lost"));

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
});
