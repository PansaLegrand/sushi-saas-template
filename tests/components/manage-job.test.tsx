import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { ManageJob } from "@admin/components/manage-job";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ManageJob", () => {
  it("requires a note and retries the selected job", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          message: "ok",
          data: { uuid: "job-1", status: "pending" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ManageJob uuid="job-1" action="retry" />);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    const confirm = screen.getByRole("button", { name: "Confirm retry" });
    expect(confirm).toBeDisabled();

    await user.type(
      screen.getByLabelText(/Operator note/),
      "Provider recovered",
    );
    await user.click(confirm);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/jobs/job-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "retry",
          note: "Provider recovered",
        }),
      }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("explains that a running cancellation cannot be recalled", async () => {
    const user = userEvent.setup();
    render(<ManageJob uuid="job-2" action="cancel" />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByText(/Running work cannot be recalled/),
    ).toBeInTheDocument();
  });
});
