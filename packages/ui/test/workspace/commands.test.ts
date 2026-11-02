/**
 * @file Tests for the command list: no two commands share keys, every key
 *   combination holds a modifier (WCAG 2.1.4), every panel can be reached, and
 *   a command that cannot run says why.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  createPreferences,
  DEFAULT_PREFERENCES,
} from "../../src/state/preferences.ts";
import { type Command, commandsFor } from "../../src/workspace/commands.ts";
import { PANELS } from "../../src/workspace/panels.tsx";
import { keysOf } from "../../src/workspace/shortcuts.ts";
import type { WorkspaceView } from "../../src/workspace/workspace-view.ts";
import { openWorkspace } from "./harness.tsx";

const VIEW: WorkspaceView = {
  wide: true,
  open: ["runs"],
  minimized: [],
  folded: [],
  active: "runs",
  floating: false,
  maximized: false,
};

const commands = (view: Partial<WorkspaceView> = {}) =>
  commandsFor(
    openWorkspace(),
    { ...VIEW, ...view },
    createPreferences(localStorage),
    DEFAULT_PREFERENCES,
  );

const combos = (): string[] =>
  commands().flatMap(({ shortcut }) =>
    shortcut === undefined ? [] : [keysOf(shortcut, false).join("+")],
  );

const holdsNoModifier = (command: Command): boolean => {
  const { shortcut } = command;
  return (
    shortcut !== undefined &&
    shortcut.alt !== true &&
    shortcut.mod !== true &&
    shortcut.ctrl !== true
  );
};

const titlesFor = (view: Partial<WorkspaceView>): string[] =>
  commands({ active: "logs", ...view }).map(command => command.title);

const disabledOf = (id: string, view: Partial<WorkspaceView> = {}) =>
  commands(view).find(command => command.id === id)?.disabled;

beforeEach(() => {
  localStorage.clear();
});

describe("the commands", () => {
  it("give no two commands the same keys", () => {
    const all = combos();
    expect(new Set(all).size).toBe(all.length);
  });

  it("hold a modifier in every combination", () => {
    expect(commands().filter(command => holdsNoModifier(command))).toEqual([]);
  });

  it("reach every panel, with keys", () => {
    const reached = commands().filter(command => command.group === "Panels");
    expect(reached.map(command => command.title)).toEqual(
      PANELS.map(panel => `Go to ${panel.title}`),
    );
    expect(reached.every(command => command.shortcut !== undefined)).toBe(true);
  });

  it("name the active panel", () => {
    const titles = commands({ active: "logs" }).map(command => command.title);
    expect(titles).toContain("Minimize Logs");
    expect(titles).toContain("Move Logs left");
    expect(titles).toContain("Make Logs wider");
  });

  it("follow the panel's state in their words", () => {
    expect(titlesFor({ maximized: true })).toContain("Restore Logs");
    expect(titlesFor({ floating: true })).toContain("Dock Logs");
  });

  it("say why when no panel is active", () => {
    expect(disabledOf("minimize", { active: null })).toBe(
      "No panel is active.",
    );
  });

  it("say why on a narrow window, and still reach the panels", () => {
    const reason = "Needs a window at least 1024 px wide.";
    expect(disabledOf("float", { wide: false })).toBe(reason);
    expect(disabledOf("next-group", { wide: false })).toBe(reason);
    expect(disabledOf("go-logs", { wide: false })).toBeUndefined();
    expect(disabledOf("reset-layout", { wide: false })).toBeUndefined();
  });

  it("say why a floating panel cannot be maximized", () => {
    expect(disabledOf("maximize", { floating: true })).toBe(
      "A floating panel cannot be maximized.",
    );
  });

  it("say why a maximized panel cannot be resized", () => {
    expect(disabledOf("resize-left", { maximized: true })).toBe(
      "Restore the panel first.",
    );
  });

  it("offers each theme and density, and says which is in use", () => {
    const view = commands().filter(command => command.group === "View");
    expect(view.map(({ title }) => title)).toEqual([
      "Theme: Follow the system",
      "Theme: Dark",
      "Theme: Light",
      "Density: Compact",
      "Density: Comfortable",
    ]);
    expect(view.filter(({ disabled }) => disabled !== undefined)).toMatchObject(
      [{ id: "theme-system" }, { id: "density-compact" }],
    );
  });

  it("changes a preference and says so", () => {
    const workspace = openWorkspace();
    const preferences = createPreferences(localStorage);
    const light = commandsFor(
      workspace,
      VIEW,
      preferences,
      DEFAULT_PREFERENCES,
    ).find(({ id }) => id === "theme-light");
    light?.run();
    expect(preferences.value.getValue().theme).toBe("light");
    expect(workspace.announcement.getValue()).toBe("Theme: Light.");
  });
});
