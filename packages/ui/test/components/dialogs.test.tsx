/**
 * @file Tests for the dialog and the confirm dialog: focus moves in and stays
 *   in, Escape closes, confirming runs the action, and they have no
 *   accessibility violations.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "../../src/components/button.tsx";
import { ConfirmDialog, Dialog } from "../../src/components/dialog.tsx";
import { violations } from "../axe.ts";

afterEach(() => {
  cleanup();
});

describe("the dialog", () => {
  it("is named, takes focus, hides the page, passes axe, and asks to close on Escape", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(
      <>
        <Button>Behind</Button>
        <Dialog
          description="Runs in this project."
          onOpenChange={onOpenChange}
          open
          title="Run workflow"
        >
          <Button>Run</Button>
        </Dialog>
      </>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Run workflow" });
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
    expect(await violations(document.body)).toEqual([]);
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Run" }),
      );
    });
    expect(screen.queryByRole("button", { name: "Behind" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

const renderConfirm = () => {
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const onConfirm = vi.fn<() => void>();
  render(
    <ConfirmDialog
      cli="ork stop 4f2a1c"
      confirm="Stop run"
      description="Running nodes are interrupted. ork resume can replay the run."
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open
      title="Stop run 4f2a1c?"
    />,
  );
  return { onOpenChange, onConfirm };
};

describe("the confirm dialog", () => {
  it("is an alert dialog, passes axe, and confirms from the keyboard", async () => {
    const { onConfirm, onOpenChange } = renderConfirm();
    const dialog = await screen.findByRole("alertdialog", {
      name: "Stop run 4f2a1c?",
    });
    expect(dialog).toBeDefined();
    expect(await violations(document.body)).toEqual([]);
    screen.getByRole("button", { name: "Stop run" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("starts on Cancel, shows its CLI twin, and cancels on Escape", async () => {
    const { onConfirm, onOpenChange } = renderConfirm();
    await screen.findByRole("alertdialog");
    expect(screen.getByText("ork stop 4f2a1c")).toBeDefined();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Cancel" }),
      );
    });
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
