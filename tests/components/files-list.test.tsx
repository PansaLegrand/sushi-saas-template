/** Pagination, failures and confirmation must remain distinguishable to users. */
import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import FilesList from "@/components/storage/files-list";
import messages from "../../messages/en.json";
const file = (name = "report.pdf") => ({
  uuid: name,
  original_filename: name,
  size: 1024,
  created_at: "2026-01-01T00:00:00.000Z",
  status: "active",
});
const response = (items: ReturnType<typeof file>[], hasMore = false) =>
  Response.json({ code: 0, data: { items, hasMore } });
function show() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FilesList />
    </NextIntlClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());
it("requires dialog confirmation and refreshes the list after deletion", async () => {
  let deleted = false;
  const fetchMock = vi.fn<typeof fetch>(async (_url, options) => {
    if (options?.method === "DELETE") deleted = true;
    return response(deleted ? [] : [file()]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  show();
  await screen.findByText("report.pdf");
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(deleted).toBe(false);
  const dialog = await screen.findByRole("dialog", { name: "Delete file?" });
  expect(dialog).toHaveAccessibleDescription(/report.pdf/);
  await user.click(within(dialog).getByRole("button", { name: "Delete" }));
  expect(await screen.findByText("No files yet")).toBeVisible();
  expect(
    fetchMock.mock.calls.filter(([, options]) => options?.method === "DELETE"),
  ).toHaveLength(1);
});
it("offers retry instead of presenting a failed load as an empty workspace", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response([file()])),
  );
  const user = userEvent.setup();
  show();
  expect(await screen.findByText("Could not load files")).toBeVisible();
  expect(screen.queryByText("No files yet")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("report.pdf")).toBeVisible();
  expect(screen.queryByText("Could not load files")).not.toBeInTheDocument();
});
it("loads older files and allows returning to the first page", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response([file("new.pdf")], true))
    .mockResolvedValueOnce(response([file("old.pdf")]))
    .mockResolvedValueOnce(response([file("new.pdf")], true));
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  show();
  await screen.findByText("new.pdf");
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("old.pdf")).toBeVisible();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  await user.click(screen.getByRole("button", { name: "Previous" }));
  expect(await screen.findByText("new.pdf")).toBeVisible();
});
it("ignores an older response that arrives after an upload refresh", async () => {
  let finish!: (response: Response) => void;
  const old = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce(response([file("fresh.pdf")])),
  );
  show();
  act(() => window.dispatchEvent(new Event("files:refresh")));
  await screen.findByText("fresh.pdf");
  await act(async () => finish(response([file("stale.pdf")])));
  await waitFor(() =>
    expect(screen.queryByText("stale.pdf")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("fresh.pdf")).toBeVisible();
});
