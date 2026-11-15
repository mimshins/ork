/**
 * @file Tests for `ork decide --follow`: the decisions open now asked first,
 *   then each one a run opens later (a run that started after it too), a
 *   decision answered elsewhere withdrawing its prompt with the attach line,
 *   Ctrl-C and `--until-idle` ending it without closing anything, `q` leaving a
 *   decision open, and the refusals (no terminal, flags that list or answer).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import {
  answerDecision,
  type EventStore,
  openStore,
  pendingDecisions,
  type RunEvent,
  storePath,
} from "@krapht/ork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { followRefusal } from "../src/commands/decide-list.ts";
import {
  followDecisions,
  type FollowFilter,
} from "../src/runs/follow-decisions.ts";
import { fakeTerm, type FakeTerm, KEY } from "./term-fake.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const finished = (runId: string): RunEvent => ({
  type: "run.finished",
  result: {
    runId,
    status: "succeeded",
    costUsd: 0,
    nodes: [],
    reasons: [],
    worktrees: [],
  },
});

/** A run recorded by this process, so it reads as running until it ends. */
const begin = (
  store: EventStore,
  id: string,
  workflow = "w",
  project = "/p",
): void => {
  store.begin({ id, workflow, file: "f", project });
  store.append(id, {
    type: "run.started",
    runId: id,
    workflow,
    entries: [],
    nodes: [{ id: "gate", type: "human.gate" }],
  });
};

const open = (store: EventStore, run: string, id: string): void => {
  const options = [{ id: "approve" }, { id: "revise" }];
  store.openDecision({
    id,
    runId: run,
    node: "gate",
    kind: "question",
    question: `Approve ${id}?`,
    options,
  });
  store.append(run, {
    type: "decision.opened",
    node: "gate",
    decision: id,
    kind: "question",
    question: `Approve ${id}?`,
    options,
  });
};

describe("ork decide --follow, in process", () => {
  let store: EventStore;
  let term: FakeTerm;
  let lines: string[];
  let controller: AbortController;
  let home: string;

  const follow = (untilIdle = false, filter: FollowFilter = {}) =>
    followDecisions(store, pendingDecisions(store, filter), filter, {
      out: line => {
        lines.push(stripVTControlCharacters(line));
      },
      home,
      intervalMs: 5,
      untilIdle,
      signal: controller.signal,
      terminal: {
        input: term.io.input,
        output: term.io.output,
        interactive: true,
        env: {},
      },
    });
  const onScreen = (text: string) =>
    vi.waitFor(() => {
      expect(term.screen().join("\n")).toContain(text);
    });
  const printed = (text: string) =>
    vi.waitFor(() => {
      expect(lines.join("\n")).toContain(text);
    });

  beforeEach(() => {
    store = openStore(":memory:");
    term = fakeTerm({ columns: 70 });
    lines = [];
    controller = new AbortController();
    home = mkdtempSync(path.join(tmpdir(), "ork-decide-follow-"));
    begin(store, "live0000");
  });
  afterEach(() => {
    controller.abort();
    store.close();
  });

  it("asks the open decisions first, then a new one, naming run and workflow, answering as decide", async () => {
    open(store, "live0000", "live-1");
    const done = follow();
    await onScreen("Approve live-1?");
    expect(term.screen().join("\n")).toContain("run live0000 · w");
    await term.press(KEY.enter);

    // A run that began after following did, with its own decision.
    begin(store, "later000", "other");
    open(store, "later000", "later-1");
    await onScreen("Approve later-1?");
    expect(term.screen().join("\n")).toContain("run later000 · other");
    await term.press(KEY.enter);

    await vi.waitFor(() => {
      expect(store.decision("later-1")?.status).toBe("answered");
    });
    expect(store.decision("live-1")).toMatchObject({
      status: "answered",
      answeredBy: "decide",
    });
    controller.abort();
    await expect(done).resolves.toBe("aborted");
  });

  it("asks a decision opened later in a run it already follows, once", async () => {
    const done = follow();
    await vi.waitFor(() => {
      expect(term.screen()).toEqual([]);
    });
    open(store, "live0000", "live-1");
    await onScreen("Approve live-1?");
    await term.press(KEY.enter);
    await vi.waitFor(() => {
      expect(store.decision("live-1")?.status).toBe("answered");
    });
    controller.abort();
    await done;

    expect(store.decisions({ status: "open" })).toEqual([]);
  });

  it("withdraws a prompt answered elsewhere and says so", async () => {
    open(store, "live0000", "live-1");
    const done = follow();
    await onScreen("Approve live-1?");
    await answerDecision(store, "live-1", "revise", home, "ui");
    store.append("live0000", {
      type: "decision.answered",
      node: "gate",
      decision: "live-1",
      answer: "revise",
      by: "ui",
    });

    await printed("live-1 answered elsewhere: revise (");
    expect(store.decision("live-1")?.answeredBy).toBe("ui");
    controller.abort();
    await done;
  });

  it("ends on Ctrl-C at a prompt, closing nothing, and counts what is left", async () => {
    open(store, "live0000", "live-1");
    const done = follow();
    await onScreen("Approve live-1?");
    await term.press(KEY.ctrlC);

    await expect(done).resolves.toBe("aborted");
    expect(lines).toContain("stopped following; 1 decision(s) still open");
    expect(store.decision("live-1")?.status).toBe("open");
    expect(store.lookup("live0000")[0]?.status).toBe("running");
  });

  it("ends on Ctrl-C at a prompt that is still open once nothing is live", async () => {
    open(store, "live0000", "live-1");
    const done = follow(true);
    await onScreen("Approve live-1?");
    store.append("live0000", finished("live0000"));
    // Following has gone idle; the prompt on screen is all that is left.
    await new Promise<void>(resolve => {
      setTimeout(resolve, 50);
    });
    await term.press(KEY.ctrlC);

    await expect(done).resolves.toBe("aborted");
    expect(lines).toContain("stopped following; 1 decision(s) still open");
    expect(store.decision("live-1")?.status).toBe("open");
  });

  it.each([
    ["workflow", { workflow: "w" }, "other000", "x", "/p"],
    ["run", { runId: "live0000" }, "other000", "w", "/p"],
    ["project", { project: "/p" }, "other000", "w", "/elsewhere"],
  ] satisfies [string, FollowFilter, string, string, string][])(
    "asks only what the %s filter keeps, and leaves the rest open",
    async (_name, filter, other, workflow, project) => {
      open(store, "live0000", "live-1");
      const done = follow(false, filter);
      await onScreen("Approve live-1?");
      // A live run outside the filter opens a decision; the one in scope next.
      begin(store, other, workflow, project);
      open(store, other, "out-1");
      await term.press(KEY.enter);
      await vi.waitFor(() => {
        expect(store.decision("live-1")?.status).toBe("answered");
      });
      open(store, "live0000", "live-2");
      await onScreen("Approve live-2?");
      expect(term.screen().join("\n")).not.toContain("out-1");
      await term.press(KEY.enter);
      await vi.waitFor(() => {
        expect(store.decision("live-2")?.status).toBe("answered");
      });
      controller.abort();
      await done;

      expect(store.decision("out-1")?.status).toBe("open");
      expect(lines).not.toContain("Approve out-1?");
    },
  );

  it("leaves a decision open on q and does not ask it again", async () => {
    open(store, "live0000", "live-1");
    const done = follow(true);
    await onScreen("Approve live-1?");
    await term.press("q");
    store.append("live0000", finished("live0000"));

    await expect(done).resolves.toBe("idle");
    expect(store.decision("live-1")?.status).toBe("open");
    expect(lines).toContain("no live runs");
  });

  it("with --until-idle waits for the run to end and for the prompt to settle", async () => {
    open(store, "live0000", "live-1");
    const done = follow(true);
    await onScreen("Approve live-1?");
    store.append("live0000", finished("live0000"));
    await term.press(KEY.enter);

    await expect(done).resolves.toBe("idle");
    expect(store.decision("live-1")?.status).toBe("answered");
    expect(lines.at(-1)).toBe("no live runs");
  });

  it("with --until-idle ends at once when no run is live", async () => {
    store.append("live0000", finished("live0000"));

    await expect(follow(true)).resolves.toBe("idle");
    expect(lines).toEqual(["no live runs"]);
  });
});

describe("ork decide --follow, flags", () => {
  let home: string;

  const ork = (args: readonly string[]) =>
    spawnSync(process.execPath, [BIN, "decide", ...args], {
      cwd: home,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: home,
        ORK_NO_UPDATE_CHECK: "1",
      },
    });

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "ork-decide-follow-flags-"));
    openStore(storePath(home)).close();
  });

  it("refuses without a terminal, and --watch is --follow", () => {
    for (const flag of ["--follow", "--watch"]) {
      const done = ork([flag]);
      expect(done.status).toBe(1);
      expect(done.stderr).toContain("--follow needs a terminal");
    }
  });

  it.each([
    ["--list"],
    ["--json"],
    ["--ids"],
    ["--limit", "2"],
    ["--id", "x"],
    ["--choose", "a"],
    ["--document"],
    ["--say", "hi"],
    ["--note", "hi"],
    ["--rating", "good"],
  ])("refuses --follow with %s in one line", (...flags) => {
    const done = ork(["--follow", ...flags]);
    expect(done.status).toBe(1);
    expect(done.stderr.trim().split("\n")).toHaveLength(1);
    expect(done.stderr).toContain(`it can't go with ${flags[0]}`);
  });

  it("refuses --until-idle without --follow, and accepts the plain flags", () => {
    expect(ork(["--until-idle"]).stderr).toContain(
      "--until-idle goes with --follow",
    );
    expect(followRefusal({ follow: true, project: "all", run: "r1" })).toBe(
      undefined,
    );
    expect(followRefusal({ follow: false, list: true })).toBeUndefined();
  });
});
