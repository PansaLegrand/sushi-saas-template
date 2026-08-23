/**
 * Browser-visible image task behavior.
 *
 * This pins the client half of replay safety (two clicks/one key), automatic
 * polling from queued to succeeded, and the rule that an uncertain network
 * response retries with the original key rather than spending twice.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageGenerationForm } from "@/components/tasks/image-generation-form";
import messages from "../../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function task(status: string, outputUrl?: string) {
  return {
    uuid: "task-1",
    userUuid: "user-1",
    type: "image_generation",
    status,
    creditsUsed: 5,
    outputUrl,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:01.000Z",
  };
}

function response(data: unknown, status = 200): Response {
  return Response.json({ code: 0, message: "ok", data }, { status });
}

function renderForm(pollIntervalMs?: number) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ImageGenerationForm pollIntervalMs={pollIntervalMs} />
    </NextIntlClientProvider>,
  );
}

function imageCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes("/api/tasks/image-generation"),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("ImageGenerationForm", () => {
  it("sends one mutation and one replay key for two synchronous clicks", () => {
    const fetchMock = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
      target: { value: "A sushi boat" },
    });
    const submit = screen.getByRole("button", { name: "Generate image" });

    act(() => {
      submit.click();
      submit.click();
    });

    const calls = imageCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0]?.[1]?.headers);
    const body = JSON.parse(String(calls[0]?.[1]?.body));
    expect(headers.get("Idempotency-Key")).toBe(body.idempotencyKey);
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("polls a queued task and renders its private signed result", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ task: task("queued"), replayed: false }, 202))
      .mockResolvedValueOnce(
        response({
          task: task("succeeded", "https://storage.test/signed-image"),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderForm(0);

    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Sushi");
    await user.click(screen.getByRole("button", { name: "Generate image" }));

    expect(await screen.findByText("Image ready")).toBeVisible();
    expect(screen.getByRole("img", { name: "Generated result" })).toHaveAttribute(
      "src",
      "https://storage.test/signed-image",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/api/tasks/task-1");
  });

  it("retains the replay key after an uncertain network failure", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(response({ task: task("queued"), replayed: true }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Sushi");
    await user.click(screen.getByRole("button", { name: "Generate image" }));
    await screen.findByText("Could not reach the server. Check your connection and try again.");
    await user.click(screen.getByRole("button", { name: "Generate image" }));

    await waitFor(() => expect(imageCalls(fetchMock)).toHaveLength(2));
    const [first, second] = imageCalls(fetchMock);
    expect(
      new Headers(first?.[1]?.headers).get("Idempotency-Key"),
    ).toBe(new Headers(second?.[1]?.headers).get("Idempotency-Key"));
  });
});
