/** Retrying a lost response must keep the video purchase identity and settings. */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import VideoForm from "@/app/[locale]/tasks/text-to-video/client-page";
import messages from "../../messages/en.json";

// The Next routing adapter needs an App Router runtime. Keep only that shell
// out of jsdom; the form, transport and billing behavior are real.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function task(status: string) {
  return {
    uuid: "video-1",
    userUuid: "user-1",
    type: "text_to_video",
    status,
    creditsUsed: 8,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}
function response(status: string) {
  return Response.json({ code: 0, data: { task: task(status) } });
}
function form(interval?: number) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VideoForm pollIntervalMs={interval} />
    </NextIntlClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());
it("reuses the same key and settings after an uncertain network failure", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error("response lost"))
    .mockResolvedValueOnce(response("succeeded"));
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  form();
  await user.type(
    screen.getByRole("textbox", {
      name: messages.tasks.textToVideo.promptLabel,
    }),
    "A calm sea",
  );
  await user.click(
    screen.getByRole("button", {
      name: messages.tasks.textToVideo.generate,
    }),
  );
  await screen.findByText(
    "Could not reach the server. Check your connection and try again.",
  );
  await user.click(
    screen.getByRole("button", {
      name: messages.tasks.textToVideo.generate,
    }),
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const bodies = fetchMock.mock.calls.map(([, options]) =>
    JSON.parse(String(options?.body)),
  );
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0]).toMatchObject({
    seconds: 8,
    aspectRatio: "landscape",
    prompt: "A calm sea",
    idempotencyKey: expect.any(String),
  });
});
it("continues polling after a transient read failure", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response("queued"))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(response("succeeded"));
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  form(1);
  await user.type(
    screen.getByRole("textbox", {
      name: messages.tasks.textToVideo.promptLabel,
    }),
    "A calm sea",
  );
  await user.click(
    screen.getByRole("button", {
      name: messages.tasks.textToVideo.generate,
    }),
  );
  expect(await screen.findByText("Video ready")).toBeVisible();
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("text-to-video"),
    ),
  ).toHaveLength(1);
});
