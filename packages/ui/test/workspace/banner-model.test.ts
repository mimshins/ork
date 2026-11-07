/**
 * @file Tests for which new-version banner shows: none without the server, a
 *   page older than the server first, then the server's upgrade, then a newer
 *   version; dismissed for a day per version; and what each says aloud when it
 *   appears mid-session. Also that Upgrade Ork… is always in the palette.
 */

import { createClient, type VersionInfo } from "@krapht/ork-server/client";
import { describe, expect, it } from "vitest";

import { type Connection, createAppState } from "../../src/state/app-state.ts";
import { DEFAULT_PREFERENCES } from "../../src/state/preferences.ts";
import {
  arrivalWords,
  bannerOf,
  DISMISS_FOR_MS,
} from "../../src/workspace/banner-model.ts";
import { commandsFor } from "../../src/workspace/commands.ts";
import { openFakeSources } from "../fake-source.ts";
import { openWorkspace } from "./harness.tsx";
import { JOB, NOTES, VERSION } from "./upgrade-fake.ts";

const NOW = Date.parse("2026-11-07T12:00:00.000Z");

const OPEN: Connection = {
  link: "open",
  server: { version: "0.3.0", pid: 1, startedAt: "then" },
};

const shown = (
  info: VersionInfo | null,
  over: Partial<Parameters<typeof bannerOf>[0]> = {},
) =>
  bannerOf({
    info,
    connection: OPEN,
    pageVersion: null,
    dismissed: undefined,
    now: NOW,
    ...over,
  });

const dismissedAt = (version: string, msAgo: number) => ({
  version,
  at: new Date(NOW - msAgo).toISOString(),
});

describe("which banner shows", () => {
  it("shows a newer version the record knows", () => {
    expect(shown(VERSION)).toEqual({
      kind: "newer",
      newer: "0.4.0",
      current: "0.3.0",
      releaseNotes: NOTES,
    });
  });

  it("shows none with nothing newer or the check off, or without the server", () => {
    const off: VersionInfo = {
      ...VERSION,
      newer: null,
      releaseNotes: null,
      check: { on: false, reason: "CI is set" },
    };
    expect(shown(off)).toBeNull();
    expect(shown(null)).toBeNull();
    expect(
      shown(VERSION, { connection: { ...OPEN, link: "lost" } }),
    ).toBeNull();
    expect(
      shown(VERSION, {
        connection: { link: "open", server: { error: "refused" } },
      }),
    ).toBeNull();
  });

  it("puts a page older than its server first, and it can't be dismissed", () => {
    expect(shown(VERSION, { pageVersion: "0.2.0" })).toEqual({
      kind: "pageOlder",
      page: "0.2.0",
      server: "0.3.0",
    });
    expect(shown(VERSION, { pageVersion: "0.3.0" })?.kind).toBe("newer");
  });

  it("shows the server's upgrade: running, installed, or failed", () => {
    expect(shown({ ...VERSION, job: JOB })).toEqual({
      kind: "running",
      latest: "0.4.0",
    });
    expect(
      shown({ ...VERSION, job: { ...JOB, state: "succeeded", code: 0 } }),
    ).toEqual({ kind: "installed", latest: "0.4.0", current: "0.3.0" });
    expect(
      shown({ ...VERSION, job: { ...JOB, state: "failed", code: 1 } }),
    ).toEqual({ kind: "failed", latest: "0.4.0", code: 1 });
  });

  it("hides a dismissed version for a day, and never a newer one", () => {
    expect(
      shown(VERSION, { dismissed: dismissedAt("0.4.0", 1000) }),
    ).toBeNull();
    expect(
      shown(VERSION, { dismissed: dismissedAt("0.4.0", DISMISS_FOR_MS) })?.kind,
    ).toBe("newer");
    expect(
      shown(VERSION, { dismissed: dismissedAt("0.3.9", 1000) })?.kind,
    ).toBe("newer");
  });
});

describe("what a banner says when it appears", () => {
  it("says a new version, an install, and an old page; not a run", () => {
    expect(arrivalWords(shown(VERSION))).toBe(
      "Ork 0.4.0 is out. Upgrade… is above the panels.",
    );
    expect(
      arrivalWords({ kind: "installed", latest: "0.4.0", current: "0.3.0" }),
    ).toBe("Ork 0.4.0 is installed; restart `ork ui` to use it.");
    expect(
      arrivalWords({ kind: "pageOlder", page: "0.3.0", server: "0.4.0" }),
    ).toBe("This page is from an older Ork. Reload to use 0.4.0.");
    expect(arrivalWords({ kind: "running", latest: "0.4.0" })).toBeNull();
    expect(arrivalWords(null)).toBeNull();
  });
});

/** The palette's commands on a narrow, empty workspace, by id. */
const commandOf = (state: ReturnType<typeof createAppState>, id: string) => {
  const found = commandsFor(
    openWorkspace(),
    {
      wide: false,
      open: [],
      minimized: [],
      folded: [],
      active: null,
      floating: false,
      maximized: false,
    },
    state,
    DEFAULT_PREFERENCES,
  ).find(command => command.id === id);
  if (found === undefined) throw new Error(`No command ${id}.`);
  return found;
};

describe("the palette", () => {
  it("always lists Upgrade Ork…, in its own group, with what it does", () => {
    const state = createAppState({
      client: createClient({ fetch: () => Promise.reject(new Error("no")) }),
      open: openFakeSources().open,
      storage: localStorage,
    });
    const upgrade = commandOf(state, "upgrade-ork");
    expect(upgrade).toMatchObject({
      title: "Upgrade Ork…",
      group: "Ork",
      detail: "Asks the registry for a new version now.",
    });
    upgrade.run();
    expect(state.version.dialog.getValue()).toBe("ask");
  });
});
