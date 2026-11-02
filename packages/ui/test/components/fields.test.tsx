/**
 * @file Tests for the select, the combobox, the checkbox and the switch: each
 *   is labeled, works from the keyboard, and has no accessibility violations.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Checkbox, Switch } from "../../src/components/checkbox.tsx";
import { Combobox } from "../../src/components/combobox.tsx";
import { Select } from "../../src/components/select.tsx";
import { violations } from "../axe.ts";

afterEach(() => {
  cleanup();
});

const OPTIONS = [
  { value: "cli", label: "claude CLI" },
  { value: "sdk", label: "Agent SDK" },
  { value: "fake", label: "Replay" },
];

describe("the select", () => {
  it("opens from the keyboard, passes axe, and chooses", async () => {
    const onChange = vi.fn<(value: string) => void>();
    render(
      <Select
        label="Driver"
        onChange={onChange}
        options={OPTIONS}
        value="cli"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Driver" });
    expect(trigger.textContent).toContain("claude CLI");
    expect(await violations(document.body)).toEqual([]);
    await userEvent.tab();
    expect(document.activeElement).toBe(trigger);
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("listbox")).toBeDefined();
    expect(await violations(document.body)).toEqual([]);
    await userEvent.keyboard("{ArrowDown}");
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("option", { name: "Agent SDK" }),
      );
    });
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("sdk");
  });
});

const renderCombobox = () => {
  const onChange = vi.fn<(value: string | null) => void>();
  render(
    <Combobox
      empty="No driver matches."
      label="Driver"
      onChange={onChange}
      options={OPTIONS}
      placeholder="Type to filter"
      value={null}
    />,
  );
  return { onChange, input: screen.getByRole("combobox", { name: "Driver" }) };
};

describe("the combobox", () => {
  it("filters as you type, passes axe, and chooses with Enter", async () => {
    const { onChange, input } = renderCombobox();
    await userEvent.click(input);
    await userEvent.keyboard("sd");
    expect(
      await screen.findByRole("option", { name: "Agent SDK" }),
    ).toBeDefined();
    expect(screen.queryByRole("option", { name: "Replay" })).toBeNull();
    expect(await violations(document.body)).toEqual([]);
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("sdk");
  });

  it("says so when nothing matches", async () => {
    const { input } = renderCombobox();
    await userEvent.click(input);
    await userEvent.keyboard("zzz");
    expect(await screen.findByText("No driver matches.")).toBeDefined();
  });
});

describe("the checkbox and the switch", () => {
  it.each([
    ["checkbox", Checkbox],
    ["switch", Switch],
  ] as const)(
    "the %s is named by its label, toggles on Space, and passes axe",
    async (role, Toggle) => {
      const onChange = vi.fn<(checked: boolean) => void>();
      render(
        <Toggle
          checked={false}
          label="Desktop notifications"
          onChange={onChange}
        />,
      );
      const toggle = screen.getByRole(role, {
        name: "Desktop notifications",
      });
      await userEvent.tab();
      expect(document.activeElement).toBe(toggle);
      await userEvent.keyboard(" ");
      expect(onChange).toHaveBeenCalledWith(true);
      expect(await violations(document.body)).toEqual([]);
    },
  );

  it.each([
    ["checkbox", Checkbox],
    ["switch", Switch],
  ] as const)("a disabled %s does not change", async (_role, Toggle) => {
    const onChange = vi.fn<(checked: boolean) => void>();
    render(
      <Toggle
        checked
        disabled
        label="Desktop notifications"
        onChange={onChange}
      />,
    );
    await userEvent.tab();
    await userEvent.keyboard(" ");
    expect(onChange).not.toHaveBeenCalled();
  });
});
