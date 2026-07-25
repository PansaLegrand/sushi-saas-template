/**
 * The behaviour a hand-rolled modal never had.
 *
 * These assertions are the reason `ui/dialog.tsx` wraps Radix rather than a
 * `fixed inset-0` div: focus containment, Escape handling, and a title the
 * dialog is actually labelled by. They are written against the primitive so
 * that swapping the implementation out has to keep the guarantees.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function Example({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>Tell us what you think.</DialogDescription>
        </DialogHeader>
        <input aria-label="Message" />
        <button>Submit</button>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("is not rendered until it is opened", () => {
    render(<Example />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("exposes an accessible name and description from the header", async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.click(screen.getByText("Open"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Send feedback");
    expect(dialog).toHaveAccessibleDescription("Tell us what you think.");
  });

  it("moves focus into the dialog and keeps Tab inside it", async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.click(screen.getByText("Open"));
    const dialog = await screen.findByRole("dialog");

    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    // Cycle past the last control; focus must land back inside, never on the
    // trigger behind the overlay.
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Example onOpenChange={onOpenChange} />);

    const trigger = screen.getByText("Open");
    await user.click(trigger);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("hides the rest of the page from assistive technology while open", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <p>Background copy</p>
        <Example />
      </div>
    );

    const background = screen.getByText("Background copy");
    expect(background.closest("[aria-hidden='true']")).toBeNull();

    await user.click(screen.getByText("Open"));
    await screen.findByRole("dialog");

    // Radix marks everything outside the portal aria-hidden, so a screen reader
    // cannot wander out of the dialog into the page behind it. This is
    // `aria-hidden`, not CSS visibility — the background stays on screen.
    expect(background.closest("[aria-hidden='true']")).not.toBeNull();
  });
});
