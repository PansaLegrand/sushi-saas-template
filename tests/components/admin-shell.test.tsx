import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdminShell } from "@admin/components/admin-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@admin/components/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));

describe("AdminShell content studio handoff", () => {
  it("renders a clearly external publishing destination when configured", () => {
    render(
      <AdminShell
        contentStudioUrl="https://content.example.com/admin"
        email="operator@example.com"
        role="admin_rw"
      >
        <p>Overview</p>
      </AdminShell>,
    );

    expect(screen.getByText("Publishing")).toBeInTheDocument();
    const link = screen.getByRole("link", {
      name: "Content Studio (opens in a new tab)",
    });
    expect(link.getAttribute("href")).toBe("https://content.example.com/admin");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("does not advertise a publishing workspace when it is unconfigured", () => {
    render(
      <AdminShell email="operator@example.com" role="admin_ro">
        <p>Overview</p>
      </AdminShell>,
    );

    expect(screen.queryByText("Content Studio")).not.toBeInTheDocument();
  });
});
