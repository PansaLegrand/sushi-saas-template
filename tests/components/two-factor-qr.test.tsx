/**
 * The two-factor setup step: QR, setup key, and backup codes.
 *
 * This screen shows a credential exactly once, and the failure mode is not a
 * crash — it is a user who screenshots the secret, or closes the tab without
 * saving the backup codes and locks themselves out. So what is asserted here is
 * mostly whether the page makes the safe path the easy one.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TwoFactorSetupPanel } from "@/components/auth/two-factor-setup-panel";

const SECRET = "OBZW4ZSEKUZW63LUIQYQ";
const TOTP_URI = `otpauth://totp/Sushi%20SaaS:user%40example.com?secret=${SECRET}&issuer=Sushi%20SaaS`;
const BACKUP_CODES = ["aaaa1-bbbb2", "cccc3-dddd4", "eeee5-ffff6"];

const mocks = vi.hoisted(() => ({
  enable: vi.fn(),
  verifyTotp: vi.fn(),
  disable: vi.fn(),
  setAccountPassword: vi.fn(),
}));

vi.mock("@/api/account", () => ({
  setAccountPassword: mocks.setAccountPassword,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    twoFactor: {
      enable: mocks.enable,
      verifyTotp: mocks.verifyTotp,
      disable: mocks.disable,
    },
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
}));

/**
 * jsdom defines `navigator.clipboard` as a getter with no setter, so assigning
 * to it throws. `defineProperty` is the only way in, and it also matches what
 * the component sees in a browser closely enough to be worth the ceremony.
 */
function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

/** Drive the panel to the point where the QR and codes are on screen. */
async function reachSetupStep(user: ReturnType<typeof userEvent.setup>) {
  mocks.enable.mockResolvedValue({
    data: { totpURI: TOTP_URI, backupCodes: BACKUP_CODES },
    error: null,
  });

  render(<TwoFactorSetupPanel initialEnabled={false} initialHasPassword />);

  await user.type(screen.getByLabelText(/Password/), "a-good-password");
  await user.click(screen.getByRole("button", { name: "Enable two-factor" }));

  await waitFor(() => {
    expect(screen.getByRole("img", { name: /QR code/i })).toBeInTheDocument();
  });
}

describe("two-factor setup step", () => {
  it("renders a scannable QR rather than only a raw URI", async () => {
    const user = userEvent.setup();
    await reachSetupStep(user);

    const qr = screen.getByRole("img", { name: /QR code/i });
    // An SVG, not an <img>: `img-src` in the CSP has no `data:`, so a data-URI
    // image would work in dev and be blocked in production.
    expect(qr.tagName.toLowerCase()).toBe("svg");
    // A QR with no dark modules is a blank square that scans as nothing.
    expect(qr.querySelector("path")?.getAttribute("d")).toBeTruthy();
  });

  it("keeps the raw secret out of sight until asked for", async () => {
    // Showing the key beside the QR invites copying a credential nobody needed
    // to see. It stays behind a disclosure for the people who cannot scan.
    const user = userEvent.setup();
    await reachSetupStep(user);

    const disclosure = screen.getByText(/Can't scan/i).closest("details");
    expect(disclosure).toBeTruthy();
    expect(disclosure).not.toHaveAttribute("open");
  });

  it("offers the setup key on its own, not just the whole URI", async () => {
    // Apps asking for a "setup key" reject a full otpauth:// string, and the
    // error they give does not explain why.
    const user = userEvent.setup();
    await reachSetupStep(user);

    await user.click(screen.getByText(/Can't scan/i));

    const details = screen.getByText(/Can't scan/i).closest("details")!;
    expect(within(details).getByText(SECRET)).toBeInTheDocument();
    expect(
      within(details).getByRole("button", { name: /Copy setup key/i })
    ).toBeInTheDocument();
    expect(
      within(details).getByRole("button", { name: /Copy authenticator URI/i })
    ).toBeInTheDocument();
  });

  it("warns that this screen will not come back before showing the codes", async () => {
    const user = userEvent.setup();
    await reachSetupStep(user);

    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
  });

  it("copies every backup code in one action", async () => {
    // The alternative is selecting ten codes by hand, which is how a screenshot
    // ends up in a photo library.
    const user = userEvent.setup();
    await reachSetupStep(user);

    // After `userEvent.setup()`, which installs a clipboard stub of its own and
    // would otherwise swallow the call this test is about.
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await user.click(screen.getByRole("button", { name: /Copy all backup codes/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(BACKUP_CODES.join("\n"));
    });
    expect(
      await screen.findByText("Copied", { selector: "[aria-live]" })
    ).toBeInTheDocument();
  });

  it("says so when the clipboard refuses", async () => {
    // `navigator.clipboard` needs a secure context and can be denied. A button
    // that silently does nothing leaves the user believing they have the codes.
    const user = userEvent.setup();
    await reachSetupStep(user);

    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    stubClipboard(writeText);

    await user.click(screen.getByRole("button", { name: /Copy all backup codes/i }));

    expect(
      await screen.findByText("Copy failed", { selector: "[aria-live]" })
    ).toBeInTheDocument();
  });

  it("downloads the codes as a file", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn().mockReturnValue("blob:codes");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    await reachSetupStep(user);
    await user.click(screen.getByRole("button", { name: /Download/i }));

    expect(createObjectURL).toHaveBeenCalled();
    // Not revoking pins the codes in memory for the life of the document.
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:codes");
  });

  it("still shows every code so they can be read off screen", async () => {
    const user = userEvent.setup();
    await reachSetupStep(user);

    for (const backupCode of BACKUP_CODES) {
      expect(screen.getByText(backupCode)).toBeInTheDocument();
    }
  });
});
