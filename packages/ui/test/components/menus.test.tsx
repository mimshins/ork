/**
 * @file Tests for the menu and the popover: they open and close from the
 *   keyboard, give focus back to their trigger, and have no accessibility
 *   violations while open.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "../../src/components/button.tsx";
import { Menu } from "../../src/components/menu.tsx";
import { Popover } from "../../src/components/popover.tsx";
import { violations } from "../axe.ts";

afterEach(() => {
  cleanup();
});

const focusOn = async (name: string) => {
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name }));
  });
};

const renderMenu = () => {
  const reset = vi.fn<() => void>();
  const close = vi.fn<() => void>();
  const help = vi.fn<() => void>();
  render(
    <Menu
      entries={[
        { label: "Reset layout", onSelect: reset },
        "separator",
        { label: "Help", onSelect: help, disabled: true },
        { label: "Close panel", onSelect: close, danger: true },
      ]}
      trigger={<Button>Window</Button>}
    />,
  );
  return { reset, close, help };
};

/** Opens the menu from the keyboard, with focus on its first item. */
const openMenu = async () => {
  await userEvent.tab();
  await userEvent.keyboard("{Enter}");
  await focusOn("Reset layout");
};

describe("the menu", () => {
  it("opens with the keyboard, passes axe, and runs an item", async () => {
    const { reset } = renderMenu();
    await openMenu();
    expect(screen.getByRole("menu")).toBeDefined();
    expect(await violations(document.body)).toEqual([]);
    await userEvent.keyboard("{Enter}");
    expect(reset).toHaveBeenCalledOnce();
  });

  it("lets the arrow keys reach a disabled item, which does nothing", async () => {
    const { close, help } = renderMenu();
    await openMenu();
    await userEvent.keyboard("{ArrowDown}");
    await focusOn("Help");
    await userEvent.keyboard("{Enter}");
    expect(help).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowDown}");
    await focusOn("Close panel");
    await userEvent.keyboard("{Enter}");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes on Escape and gives focus back to its trigger", async () => {
    renderMenu();
    await openMenu();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Window" }),
      );
    });
  });
});

describe("the popover", () => {
  it("opens with the keyboard, passes axe, and closes on Escape", async () => {
    render(
      <Popover
        title="Budget"
        trigger={<Button>Budget</Button>}
      >
        <p>$1.42 of $2.00</p>
      </Popover>,
    );
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Budget" });
    expect(dialog).toBeDefined();
    expect(await violations(document.body)).toEqual([]);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Budget" }),
      );
    });
  });
});
