/**
 * @file Tests for the button, the icon button and the tooltip: they work from
 *   the keyboard, name themselves, show and describe their CLI twin, and have
 *   no accessibility violations.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, IconButton } from "../../src/components/button.tsx";
import { IconPause } from "../../src/components/icons.tsx";
import { violations } from "../axe.ts";

afterEach(() => {
  cleanup();
});

describe("the button", () => {
  it("runs on Enter and on Space, and passes axe", async () => {
    const onClick = vi.fn<() => void>();
    render(<Button onClick={onClick}>Run workflow</Button>);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button"));
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(await violations(document.body)).toEqual([]);
  });

  it("does nothing when disabled, and leaves the tab order", async () => {
    const onClick = vi.fn<() => void>();
    render(
      <Button
        disabled
        onClick={onClick}
      >
        Stop
      </Button>,
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(document.body);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows its CLI twin on focus and describes it", async () => {
    render(<Button cli="ork stop 4f2a1c">Stop</Button>);
    await userEvent.tab();
    const button = screen.getByRole("button", { name: "Stop" });
    expect(button.getAttribute("aria-description")).toBe(
      "CLI: ork stop 4f2a1c",
    );
    expect(await screen.findByText("ork stop 4f2a1c")).toBeDefined();
    expect(await violations(document.body)).toEqual([]);
  });
});

describe("the icon button", () => {
  it("is named by its label, which its tooltip shows on focus", async () => {
    const onClick = vi.fn<() => void>();
    render(
      <IconButton
        cli="ork pause 4f2a1c"
        label="Pause run"
        onClick={onClick}
      >
        <IconPause />
      </IconButton>,
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Pause run" }),
    );
    expect(await screen.findByText("Pause run")).toBeDefined();
    expect(await screen.findByText("ork pause 4f2a1c")).toBeDefined();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
    expect(await violations(document.body)).toEqual([]);
  });

  it("closes its tooltip on Escape", async () => {
    render(
      <IconButton label="Pause run">
        <IconPause />
      </IconButton>,
    );
    await userEvent.tab();
    await screen.findByText("Pause run");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(screen.queryByText("Pause run")).toBeNull();
    });
  });
});
