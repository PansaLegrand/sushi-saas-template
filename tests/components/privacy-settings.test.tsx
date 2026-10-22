/** Destructive controls require deliberate confirmation; failed requests must not leak server text. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";
import { ClientApiError } from "@/lib/errors/client";
const mocks = vi.hoisted(() => ({
  requestAccountDeletion: vi.fn<typeof import("@/api/account").requestAccountDeletion>(),
  cancelAccountDeletion: vi.fn<typeof import("@/api/account").cancelAccountDeletion>(),
  getAccountDeletion: vi.fn<typeof import("@/api/account").getAccountDeletion>(),
  requestDataExport: vi.fn<typeof import("@/api/account").requestDataExport>(),
  getLatestDataExport: vi.fn<typeof import("@/api/account").getLatestDataExport>(),
  getDataExport: vi.fn<typeof import("@/api/account").getDataExport>(),
}));
vi.mock("@/api/account", () => mocks);
import { PrivacySettings } from "@/components/account/privacy-settings";

function mount() {
  return render(<NextIntlClientProvider locale="en" messages={messages}><PrivacySettings email="owner@example.test" initialExport={null} initialDeletion={null} graceDays={7} /></NextIntlClientProvider>);
}
beforeEach(() => vi.resetAllMocks());
describe("privacy controls", () => {
  it("requires email confirmation and exposes ownership blockers without raw errors", async () => {
    mocks.requestAccountDeletion.mockRejectedValue(new ClientApiError({ code: "ACCOUNT_DELETION_OWNER_TRANSFER_REQUIRED", status: 409, message: "private database detail", details: { organizations: [{ slug: "team", name: "Team workspace" }] } }));
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole("button", { name: messages.account.privacy.deleteAction }));
    const dialog = within(screen.getByRole("dialog"));
    const confirm = dialog.getByRole("button", { name: messages.account.privacy.scheduleDeletion });
    expect(confirm).toBeDisabled();
    await user.type(dialog.getByRole("textbox"), "owner@example.test");
    await user.click(confirm);
    expect(await screen.findByRole("link", { name: "Team workspace" })).toHaveAttribute("href", "/account/team?org=team");
    expect(screen.queryByText("private database detail")).not.toBeInTheDocument();
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1);
  });
  it("reuses the export intent after a failed submission", async () => {
    mocks.requestDataExport.mockRejectedValue(new Error("internal secret"));
    const user = userEvent.setup(); mount();
    const button = screen.getByRole("button", { name: messages.account.privacy.createExport });
    await user.click(button); await screen.findByRole("alert");
    await user.click(button);
    expect(mocks.requestDataExport).toHaveBeenCalledTimes(2);
    expect(mocks.requestDataExport.mock.calls[0][0]).toBe(mocks.requestDataExport.mock.calls[1][0]);
    expect(screen.queryByText("internal secret")).not.toBeInTheDocument();
  });
});
