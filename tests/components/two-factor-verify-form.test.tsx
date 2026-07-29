/**
 * MFA is an intermediate authentication step, not a new navigation decision.
 * Losing the callback here strands checkout users on the home page and drops
 * the workspace selected before login.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TwoFactorVerifyForm } from "@/components/auth/two-factor-verify-form";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  verifyBackupCode: vi.fn(),
  verifyTotp: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
  useRouter: () => ({
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      authenticatorCode: "Authenticator code",
      backupCode: "Backup code",
      trustDevice: "Trust this device",
      verifying: "Verifying…",
      verify: "Verify",
      useBackupCode: "Use a backup code",
      useAuthenticatorCode: "Use an authenticator code",
    })[key] ?? key,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    twoFactor: {
      verifyBackupCode: mocks.verifyBackupCode,
      verifyTotp: mocks.verifyTotp,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyTotp.mockResolvedValue({ error: null });
  mocks.verifyBackupCode.mockResolvedValue({ error: null });
});

describe("TwoFactorVerifyForm", () => {
  it("returns to the validated checkout workspace after verification", async () => {
    const user = userEvent.setup();
    render(
      <TwoFactorVerifyForm callbackUrl="/pricing?org=team-workspace" />,
    );

    await user.type(screen.getByLabelText(/Authenticator code/), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(mocks.verifyTotp).toHaveBeenCalledWith({
      code: "123456",
      trustDevice: false,
    });
    expect(mocks.replace).toHaveBeenCalledWith(
      "/pricing?org=team-workspace",
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("falls back to the account shell for an external callback", async () => {
    const user = userEvent.setup();
    render(
      <TwoFactorVerifyForm callbackUrl="https://evil.example/collect" />,
    );

    await user.type(screen.getByLabelText(/Authenticator code/), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(mocks.replace).toHaveBeenCalledWith("/account/billing");
  });
});
