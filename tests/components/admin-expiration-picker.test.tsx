import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExpirationPicker } from "@admin/components/expiration-picker";

describe("ExpirationPicker", () => {
  it("makes an indefinite plan the explicit default", () => {
    render(
      <ExpirationPicker
        kind="plan"
        value={null}
        onChange={() => {}}
        subject="Complimentary Plus access"
      />,
    );

    expect(screen.getByText("Never expires")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Complimentary Plus access stays active until an admin revokes it.",
      ),
    ).toBeInTheDocument();
  });

  it("opens a calendar and emits an exact ISO timestamp for a preset", async () => {
    const onChange = vi.fn();
    const before = Date.now();
    const user = userEvent.setup();
    render(
      <ExpirationPicker kind="credits" value={null} onChange={onChange} />,
    );

    await user.click(screen.getByText("Never expires"));
    expect(screen.getByText("When should it expire?")).toBeInTheDocument();
    expect(screen.getByRole("grid")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "30 days" }));

    const emitted = new Date(onChange.mock.calls[0]?.[0] as string).getTime();
    expect(emitted).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000);
    expect(emitted).toBeLessThanOrEqual(Date.now() + 30 * 24 * 60 * 60 * 1000);
  });

  it("explains exactly what a dated credit grant changes", () => {
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    render(
      <ExpirationPicker
        kind="credits"
        value={expiry.toISOString()}
        onChange={() => {}}
      />,
    );

    expect(
      screen.getByText(
        /Unused credits from this grant stop being spendable on .+ Credits already spent are unaffected\./,
      ),
    ).toBeInTheDocument();
  });
});
