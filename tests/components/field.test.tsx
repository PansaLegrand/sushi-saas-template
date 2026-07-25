/**
 * `Field` exists to make the correct ARIA wiring unavoidable. These tests are
 * what "correct" means — they fail if the render-prop stops handing the control
 * its id, or stops connecting the error message to it.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

describe("Field", () => {
  it("associates the label with the control", () => {
    render(
      <Field label="Contact email">{(field) => <Input {...field} type="email" />}</Field>
    );

    expect(screen.getByLabelText("Contact email")).toHaveAttribute("type", "email");
  });

  it("connects description and error to the control for screen readers", () => {
    render(
      <Field label="Password" description="At least 8 characters." error="Too short.">
        {(field) => <Input {...field} type="password" />}
      </Field>
    );

    const input = screen.getByLabelText("Password");
    expect(input).toHaveAccessibleDescription("At least 8 characters. Too short.");
    expect(input).toBeInvalid();
  });

  it("announces the error and leaves the control valid when there is none", () => {
    const { rerender } = render(
      <Field label="Email" error="Enter a valid email.">
        {(field) => <Input {...field} />}
      </Field>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email.");

    rerender(<Field label="Email">{(field) => <Input {...field} />}</Field>);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).not.toBeInvalid();
  });

  it("marks a required field for assistive technology, not just visually", () => {
    render(
      <Field label="Email" required>
        {(field) => <Input {...field} />}
      </Field>
    );

    expect(screen.getByLabelText(/Email/)).toHaveAttribute("aria-required", "true");
  });
});
