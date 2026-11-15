/**
 * @file Tests `ork decide --follow` end to end on a real terminal (a pty from
 *   `script`) with several live runs at once: the open decisions of three runs
 *   asked one card at a time in the store's order, a run that starts later and
 *   a run it calls asked too, a card answered elsewhere withdrawn, Ctrl-C
 *   leaving the rest open, and `--until-idle` ending once every run has. Runs
 *   are seeded into the store by this process, so they read as live.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import {
  answerDecision,
  type EventStore,
  openStore,
  type RunEvent,
  storePath,
} from "@krapht/ork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasPty, orkOnPty, pressCtrlC, type PtyOrk } from "./pty.ts";

const NOTE = "Note for the run";
const WAIT = { timeout: 15_000 };

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
  workflow: string,
  parent?: string,
): void => {
  store.begin({
    id,
    workflow,
    file: "f",
    project: "/p",
    ...(parent === undefined ? {} : { parent }),
  });
  store.append(id, {
    type: "run.started",
    runId: id,
    workflow,
    entries: [],
    nodes: [{ id: "gate", type: "human.gate" }],
  });
};

/** `caller`'s node `node` calls `workflow` as the run `called`. */
const call = (
  store: EventStore,
  caller: string,
  node: string,
  called: string,
  workflow: string,
): void => {
  // Record the called run first, as core/src/remote/calls.ts does.
  begin(store, called, workflow, caller);
  store.append(caller, {
    type: "call.started",
    node,
    run: called,
    workflow,
    project: "/p",
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

/** Answers `id` as `ork ui` would, with the event a run stores for it. */
const answerInUi = async (
  store: EventStore,
  home: string,
  run: string,
  id: string,
): Promise<void> => {
  await answerDecision(store, id, "revise", home, "ui");
  store.append(run, {
    type: "decision.answered",
    node: "gate",
    decision: id,
    answer: "revise",
    by: "ui",
  });
};

/** What the terminal shows, escapes gone. */
const screen = (pty: PtyOrk): string => stripVTControlCharacters(pty.output());

/**
 * The last line printed: macOS's `script` echoes the closed input (`^D`, then
 * backspaces) after it.
 */
const lastLine = (text: string): string | undefined =>
  text
    .split("\n")
    .map(line => line.replaceAll("^D", "").replaceAll(/\p{Cc}/gu, ""))
    .findLast(line => line.trim() !== "");

const onScreen = (pty: PtyOrk, text: string) =>
  vi.waitFor(() => {
    expect(screen(pty)).toContain(text);
  }, WAIT);

/**
 * Approves the card on screen: `NO_COLOR` makes it a plain line prompt, so
 * option 1 and Enter, then Enter to skip the note it asks for next.
 */
const approve = async (pty: PtyOrk): Promise<void> => {
  const notes = screen(pty).split(NOTE).length;
  pty.keys.write("1\r");
  await vi.waitFor(() => {
    expect(screen(pty).split(NOTE).length).toBeGreaterThan(notes);
  }, WAIT);
  pty.keys.write("\r");
};

const answered = (store: EventStore, id: string) =>
  vi.waitFor(() => {
    expect(store.decision(id)?.status).toBe("answered");
  }, WAIT);

/** Presses Enter on each card in turn, waiting for its answer to be stored. */
const answerInTurn = async (
  store: EventStore,
  pty: PtyOrk,
  ids: readonly string[],
): Promise<void> => {
  for (const id of ids) {
    // oxlint-disable-next-line no-await-in-loop -- one card at a time
    await onScreen(pty, `Approve ${id}?`);
    // oxlint-disable-next-line no-await-in-loop -- one card at a time
    await approve(pty);
    // oxlint-disable-next-line no-await-in-loop -- one card at a time
    await answered(store, id);
  }
};

/** `texts` in the order they first appear in `text`; a missing one first. */
const inOrderOf = (text: string, texts: readonly string[]): string[] =>
  texts.toSorted((a, b) => text.indexOf(a) - text.indexOf(b));

describe.skipIf(!hasPty)("ork decide --follow with many live runs", () => {
  let home: string;
  let store: EventStore;
  let ork: PtyOrk | undefined;

  const start = (args: readonly string[]): PtyOrk => {
    ork = orkOnPty(["decide", "--follow", "--project", "all", ...args], {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      NO_COLOR: "1",
      ORK_NO_UPDATE_CHECK: "1",
    });
    return ork;
  };

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "ork-decide-follow-many-"));
    store = openStore(storePath(home));
    begin(store, "aaaa0001", "w1");
    begin(store, "bbbb0002", "w2");
    begin(store, "cccc0003", "w3");
    open(store, "aaaa0001", "a-1");
    open(store, "bbbb0002", "b-1");
    open(store, "cccc0003", "c-1");
  });

  afterEach(() => {
    ork?.child.kill("SIGKILL");
    ork?.keys.destroy();
    ork = undefined;
    store.close();
  });

  it("asks every run's decisions one card at a time, a later and a called run's too, until Ctrl-C", async () => {
    const follow = start([]);

    // The three open now, in the store's order, one card at a time.
    await onScreen(follow, "Approve a-1?");
    expect(screen(follow)).toContain("run aaaa0001 · w1");
    expect(screen(follow)).not.toContain("Approve b-1?");
    await approve(follow);
    await onScreen(follow, "Approve b-1?");
    expect(screen(follow)).toContain("run bbbb0002 · w2");
    expect(screen(follow)).not.toContain("Approve c-1?");
    await approve(follow);
    await onScreen(follow, "Approve c-1?");
    expect(screen(follow)).toContain("run cccc0003 · w3");
    await approve(follow);
    await answered(store, "c-1");
    const firstThree = ["Approve a-1?", "Approve b-1?", "Approve c-1?"];
    expect(inOrderOf(screen(follow), firstThree)).toEqual(firstThree);
    expect(
      ["a-1", "b-1", "c-1"].map(id => store.decision(id)?.answeredBy),
    ).toEqual(["decide", "decide", "decide"]);

    // A run that starts now, and a run it calls, each open one.
    begin(store, "dddd0004", "w4");
    open(store, "dddd0004", "d-1");
    await onScreen(follow, "Approve d-1?");
    expect(screen(follow)).toContain("run dddd0004 · w4");
    call(store, "dddd0004", "sub", "eeee0005", "w5");
    open(store, "eeee0005", "e-1");
    await approve(follow);
    await onScreen(follow, "Approve e-1?");
    expect(screen(follow)).toContain("run eeee0005 · w5 · sub");
    await approve(follow);
    await answered(store, "e-1");
    expect(store.decision("e-1")?.answeredBy).toBe("decide");

    // One answered in ork ui while its card is up: withdrawn, the next shown.
    open(store, "dddd0004", "d-2");
    open(store, "dddd0004", "d-3");
    open(store, "dddd0004", "d-4");
    await onScreen(follow, "Approve d-2?");
    await answerInUi(store, home, "dddd0004", "d-2");
    await onScreen(follow, "d-2 answered elsewhere: revise (ork ui)");
    await onScreen(follow, "Approve d-3?");
    const withdrawn = ["d-2 answered elsewhere", "Approve d-3?"];
    expect(inOrderOf(screen(follow), withdrawn)).toEqual(withdrawn);
    expect(store.decision("d-2")?.answeredBy).toBe("ui");

    // Ctrl-C with d-3 on screen and d-4 behind it.
    await pressCtrlC(follow);
    await expect(follow.exited).resolves.toBe(0);
    expect(lastLine(screen(follow))).toBe(
      "stopped following; 2 decision(s) still open",
    );
    expect(["d-3", "d-4"].map(id => store.decision(id)?.status)).toEqual([
      "open",
      "open",
    ]);
  }, 90_000);

  it("with --until-idle ends with no live runs once every run has", async () => {
    const follow = start(["--until-idle"]);

    await answerInTurn(store, follow, ["a-1", "b-1", "c-1"]);
    store.append("aaaa0001", finished("aaaa0001"));
    store.append("bbbb0002", finished("bbbb0002"));
    store.append("cccc0003", finished("cccc0003"));

    await onScreen(follow, "no live runs");
    // Linux's `script` waits for its input to end before it exits.
    follow.keys.end();
    await expect(follow.exited).resolves.toBe(0);
  }, 60_000);
});
