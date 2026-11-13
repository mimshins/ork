/**
 * @file Tests for the list filter bar: it is built from the fields the server
 *   sends (a select for an enum, an input for text and times), applies an input
 *   on Enter, on leaving it or on a suggestion and a select on change, says the
 *   server's refusal inline on the field it names, clears everything, and keeps
 *   accessible names and descriptions. Each test is a bar on a fake server.
 */

import type { ListName } from "@krapht/ork-server/client";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FilterValues } from "../../src/components/filter-model.ts";
import { FilterEmpty } from "../../src/components/filter-notes.tsx";
import { violations } from "../axe.ts";
import {
  describedText,
  draw,
  drawNow,
  type HostProps,
  stateOn,
} from "./filter-harness.tsx";

const applied = () => vi.fn<(next: FilterValues) => void>();

afterEach(() => {
  cleanup();
});

describe("the bar's fields", () => {
  it("is a search named for the list, with a labelled control for each field", async () => {
    await draw({ list: "runs" });
    const bar = screen.getByRole("search", { name: "Filter runs" });
    expect(within(bar).getByRole("combobox", { name: "Status" })).toBeDefined();
    for (const label of ["Workflow", "Since", "Until"]) {
      expect(within(bar).getByRole("combobox", { name: label })).toBeDefined();
    }
    // Project hides until there is more than one to choose from.
    expect(within(bar).queryByRole("combobox", { name: "Project" })).toBeNull();
  });

  it.each([
    ["runs", "Filter runs"],
    ["decisions", "Filter decisions"],
    ["follow-ups", "Filter follow-ups"],
    ["feedback", "Filter feedback"],
    ["worktrees", "Filter worktrees"],
    ["usage", "Filter usage"],
  ] as [ListName, string][])("%s is named `%s`", async (list, name) => {
    await draw({ list });
    expect(screen.getByRole("search", { name })).toBeDefined();
  });

  it("shows Project once the panel offers two projects, or one is set", async () => {
    await draw({
      list: "worktrees",
      suggestions: {
        project: [
          { value: "a", label: "a" },
          { value: "b", label: "b" },
        ],
      },
    });
    expect(screen.getByRole("combobox", { name: "Project" })).toBeDefined();
    cleanup();
    await draw({ list: "worktrees", start: { project: "a" } });
    expect(screen.getByRole("combobox", { name: "Project" })).toBeDefined();
  });

  it("describes each field by the table's own help line", async () => {
    await draw({ list: "runs" });
    const input = screen.getByRole("combobox", { name: "Workflow" });
    expect(describedText(input)).toBe("Only this workflow's runs");
  });

  it("says it is reading the fields, then shows them", async () => {
    const { state } = stateOn();
    drawNow({ list: "usage" }, state);
    expect(screen.getByText("Reading filters…")).toBeDefined();
    expect(
      await screen.findByRole("combobox", { name: "Workflow" }),
    ).toBeDefined();
    expect(screen.queryByText("Reading filters…")).toBeNull();
  });

  it("says why it has no fields, offers the help command, and tries again", async () => {
    const { state, reads } = stateOn(1);
    drawNow({ list: "runs" }, state);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Couldn't read the filter fields: Nothing answers.. The list shows without filters.",
    );
    expect(screen.getByText("ork ps --help")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("combobox", { name: "Workflow" }),
    ).toBeDefined();
    expect(reads()).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("an enum field", () => {
  it("offers the table's values, Any first, and applies on change", async () => {
    const onChange = applied();
    await draw({ list: "runs", onChange });
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    const options = (await screen.findAllByRole("option")).map(
      option => option.textContent,
    );
    expect(options).toEqual([
      "Any",
      "running",
      "paused",
      "crashed",
      "succeeded",
      "failed",
      "budget_exhausted",
      "quota_exhausted",
      "timed_out",
      "interrupted",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "paused" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ status: "paused" });
  });

  it("reads Default (...) and adds All last when the panel has a default", async () => {
    await draw({ list: "feedback", defaults: { status: "not dismissed" } });
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    const options = (await screen.findAllByRole("option")).map(
      option => option.textContent,
    );
    expect(options[0]).toBe("Default (not dismissed)");
    expect(options.at(-1)).toBe("All");
  });

  it("choosing the unset option removes the field", async () => {
    const onChange = applied();
    await draw({ list: "runs", start: { status: "failed" }, onChange });
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Any" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({});
  });
});

describe("a text field", () => {
  it("applies on Enter, not while typing, trimmed", async () => {
    const onChange = applied();
    await draw({ list: "runs", onChange });
    const input = screen.getByRole("combobox", { name: "Workflow" });
    await userEvent.type(input, "  feature ");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ workflow: "feature" });
  });

  it("applies on leaving the field, and says nothing when nothing changed", async () => {
    const onChange = applied();
    await draw({ list: "runs", onChange });
    const input = screen.getByRole("combobox", { name: "Workflow" });
    await userEvent.click(input);
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.type(input, "review");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ workflow: "review" });
  });

  it("an empty text unsets the field", async () => {
    const onChange = applied();
    await draw({ list: "runs", start: { workflow: "feature" }, onChange });
    const input = screen.getByRole("combobox", { name: "Workflow" });
    await userEvent.clear(input);
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({});
  });

  it("Escape takes the draft back to the applied value", async () => {
    const onChange = applied();
    await draw({ list: "runs", start: { workflow: "feature" }, onChange });
    const input = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Workflow",
    });
    await userEvent.type(input, "xyz");
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    expect(input.value).toBe("feature");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a suggestion applies its value, and the built-in ones are there for a time", async () => {
    const onChange = applied();
    await draw({ list: "runs", onChange });
    const since = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Since",
    });
    expect(since.placeholder).toBe("24h, 30d or 2026-11-01");
    await userEvent.click(since);
    await userEvent.keyboard("{ArrowDown}");
    const items = (await screen.findAllByRole("option")).map(
      option => option.textContent,
    );
    expect(items).toEqual(["24h", "7d", "30d", "90d", "all"]);
    await userEvent.click(screen.getByRole("option", { name: "7d" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ since: "7d" });
  });

  it("offers the panel's own suggestions by label and applies their value", async () => {
    const onChange = applied();
    await draw({
      list: "decisions",
      onChange,
      suggestions: { run: [{ value: "4f2a1c", label: "4f2a1c · feature" }] },
    });
    await userEvent.click(screen.getByRole("combobox", { name: "Run" }));
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.click(
      await screen.findByRole("option", { name: "4f2a1c · feature" }),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ run: "4f2a1c" });
  });

  it("shows the panel's default as the placeholder", async () => {
    await draw({ list: "usage", defaults: { since: "30d" } });
    expect(
      screen.getByRole<HTMLInputElement>("combobox", { name: "Since" })
        .placeholder,
    ).toBe("Default: 30d");
  });
});

describe("a refused value", () => {
  const MESSAGE = "--since takes an age, a day or all, not `soon`.";

  it("says it inline, marks the field the message names, and keeps focus", async () => {
    await draw({
      list: "runs",
      start: { since: "soon" },
      error: { message: MESSAGE },
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      `${MESSAGE.replaceAll("`", "")} The list shows the last filter that worked. Fix the value, or clear the filter.`,
    );
    const since = screen.getByRole("combobox", { name: "Since" });
    expect(since.getAttribute("aria-invalid")).toBe("true");
    expect(since.getAttribute("aria-describedby")).toContain(alert.id);
    expect(
      screen
        .getByRole("combobox", { name: "Workflow" })
        .getAttribute("aria-invalid"),
    ).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("marks a select by the field the panel names", async () => {
    await draw({
      list: "runs",
      start: { status: "x" },
      error: { message: "Bad.", field: "status" },
    });
    expect(
      screen
        .getByRole("combobox", { name: "Status" })
        .getAttribute("aria-invalid"),
    ).toBe("true");
  });
});

describe("Clear filter and the command", () => {
  it("shows neither while nothing is set", async () => {
    await draw({ list: "runs" });
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();
    expect(screen.queryByText(/^ork ps/u)).toBeNull();
  });

  it("shows the matching command and the clear button once filtered", async () => {
    await draw({ list: "runs", start: { status: "failed" } });
    expect(screen.getByText("ork ps --status failed")).toBeDefined();
    expect(
      screen.getByRole("button", {
        name: "Copy command (ork ps --status failed)",
      }),
    ).toBeDefined();
  });

  it("resets every field, drops a pending text, and puts focus on the first field", async () => {
    const onChange = applied();
    await draw({ list: "runs", start: { status: "failed" }, onChange });
    await userEvent.type(
      screen.getByRole("combobox", { name: "Workflow" }),
      "pending",
    );
    // An open suggestion list hides the rest of the page from a screen reader.
    await userEvent.click(
      screen.getByRole("button", { name: "Clear filter", hidden: true }),
    );
    // The click leaves the text field first, which applied nothing.
    expect(onChange).toHaveBeenCalledExactlyOnceWith({});
    expect(
      screen.getByRole<HTMLInputElement>("combobox", { name: "Workflow" })
        .value,
    ).toBe("");
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: "Status" }),
    );
    expect(screen.getByText("Filter cleared.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();
  });
});

describe("the count line", () => {
  it.each([
    [{ start: { status: "failed" }, shown: 3 }, "3 runs match."],
    [{ start: { status: "failed" }, shown: 1 }, "1 run matches."],
    [{ start: { status: "failed" }, shown: 0 }, "No runs match."],
    [{ start: { status: "failed" }, shown: 3, busy: true }, "Updating…"],
    [{ summary: "3 due, 5 waiting" }, "3 due, 5 waiting"],
  ] as [Partial<HostProps>, string][])("%j says `%s`", async (props, line) => {
    await draw({ list: "runs", ...props });
    expect(screen.getByText(line).tagName).toBe("OUTPUT");
  });
});

describe("the empty state", () => {
  it("names the filter, offers the command, and clears", async () => {
    const onClear = vi.fn<() => void>();
    render(
      <FilterEmpty
        list="runs"
        onClear={onClear}
        values={{ status: "failed" }}
      />,
    );
    expect(screen.getByText("No runs match the filter.")).toBeDefined();
    expect(screen.getByText("ork ps --status failed")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe("accessibility", () => {
  it("passes axe, filtered and refused", async () => {
    await draw({
      list: "follow-ups",
      start: { status: "due", for: "me" },
      shown: 2,
      error: {
        message: "--for takes one of agent, me, not `x`.",
        field: "for",
      },
    });
    expect(await violations(document.body)).toEqual([]);
  });
});
