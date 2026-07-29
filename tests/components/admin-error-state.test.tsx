import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AdminErrorState } from "@admin/components/admin-error-state";

describe("AdminErrorState", () => {
  it("offers recovery without exposing the thrown exception", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const error = Object.assign(
      new Error("postgres://operator:secret@database.internal/production"),
      { digest: "render-42" },
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<AdminErrorState error={error} reset={reset} embedded />);

    const heading = screen.getByRole("heading", {
      name: "This admin view could not load",
    });
    expect(heading).toHaveFocus();
    expect(screen.getByText("Reference: render-42")).toBeInTheDocument();
    expect(screen.queryByText(/operator:secret/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to overview" }),
    ).toHaveAttribute("href", "/");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
