/**
 * @file Tests for a foreground caller's terminal (ADR-081): a `start`-shaped
 *   run calls `plan`, whose gate is asked and answered on the caller's terminal
 *   with `plan`'s lines under its call path; Ctrl-C at that prompt stops the
 *   caller and `plan`; with no one at the terminal, `plan`'s gate waits for
 *   `ork decide`. The called run runs in this process, as `ork run` would start
 *   it in the background.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import {
  answerDecision,
  type EventStore,
  openStore,
  pendingDecisions,
  type RunHandle,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callsShown,
  createTerminalHuman,
  runWorkflowFile,
  type RunWorkflowResult,
  type TerminalHuman,
} from "../src/index.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";
import { fakeTerm, type FakeTerm, KEY } from "./term-fake.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const START = [
  "schemaVersion: 1",
  "name: start",
  "nodes:",
  "  plan:",
  "    type: workflow.call",
  "    workflow: plan",
  "",
].join("\n");

/** `start`, going on once `plan` has started. */
const START_NO_WAIT = START.replace(
  "    workflow: plan\n",
  "    workflow: plan\n    wait: none\n",
);

const PLAN = [
  "schemaVersion: 1",
  "name: plan",
  "nodes:",
  "  approve:",
  "    type: human.gate",
  "    question: Approve the spec?",
  "    options: [approve, revise]",
  "    recommended: approve",
  "",
].join("\n");

const ignore = (): void => {
  // The called run's own output goes to its log in a real run.
};

type Caller = {
  dir: string;
  home: string;
  store: EventStore;
  term: FakeTerm;
  human: TerminalHuman;
  /** The caller's transcript, styles left out. */
  out: string[];
  /** The called runs, running in this process. */
  called: Promise<RunWorkflowResult>[];
  live: { handle?: RunHandle };
  done: Promise<RunWorkflowResult>;
};

const opened: Caller[] = [];

/**
 * Runs `start` from a terminal where a person is (`interactive`) or not; its
 * Ctrl-C interrupts the caller, as `ork run` does.
 */
const runStart = (interactive: boolean, start = START): Caller => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-calls-tty-")));
  // Marks the project's root; the run is in place, so git isn't asked.
  mkdirSync(path.join(dir, ".git"));
  const workflows = path.join(dir, ".ork", "workflows");
  mkdirSync(workflows, { recursive: true });
  writeFileSync(path.join(workflows, "start.ork.yaml"), start);
  writeFileSync(path.join(workflows, "plan.ork.yaml"), PLAN);
  const home = mkdtempSync(path.join(tmpdir(), "ork-home-"));
  const store = openStore(":memory:");
  const term = fakeTerm();
  const live: { handle?: RunHandle } = {};
  const human = createTerminalHuman({
    input: term.io.input,
    output: term.io.output,
    interactive,
    env: {},
    interrupt: () => {
      live.handle?.interrupt();
    },
  });
  const out: string[] = [];
  const called: Promise<RunWorkflowResult>[] = [];
  const common = {
    cwd: dir,
    inputs: [],
    inPlace: true,
    allowDirty: true,
    json: false,
    runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
    driverChecks: openCodeReady,
    drivers: standInDrivers,
    store,
    home,
    intervalMs: 60_000,
    err: ignore,
    installed: () => true,
  };
  const done = runWorkflowFile({
    ...common,
    file: path.join(workflows, "start.ork.yaml"),
    human,
    showCalls: callsShown(human, interactive),
    out: line => {
      out.push(stripVTControlCharacters(line));
    },
    onRun: handle => {
      live.handle = handle;
    },
    // What `ork run --detach` would start, with no terminal of its own.
    detach: async ({ runId, args, cwd }) => {
      called.push(
        runWorkflowFile({
          ...common,
          file: String(args[1]),
          cwd,
          runId,
          calledBy: String(args[5]),
          out: ignore,
        }),
      );
      await vi.waitFor(() => {
        expect(store.lookup(runId)).toHaveLength(1);
      });
      return { ok: true, runId, log: "" };
    },
  });
  const caller = { dir, home, store, term, human, out, called, live, done };
  opened.push(caller);
  return caller;
};

/** The called `plan` run's id. */
const planRun = (caller: Caller): string =>
  String(caller.store.runs().find(run => run.workflow === "plan")?.id);

/** Waits for the gate's card on the caller's terminal. */
const asked = (caller: Caller) =>
  vi.waitFor(
    () => {
      expect(caller.term.screen().join("\n")).toContain("Approve the spec?");
    },
    { timeout: 5000 },
  );

/** Waits for `plan`'s gate to be open. */
const gateOpen = (caller: Caller) =>
  vi.waitFor(
    () => {
      expect(pendingDecisions(caller.store, {})).toHaveLength(1);
    },
    { timeout: 5000 },
  );

/** How `plan`'s gate was answered, from its events. */
const answeredBy = (caller: Caller) =>
  caller.store
    .events(planRun(caller))
    .map(({ event }) => event)
    .find(event => event.type === "decision.answered");

afterEach(() => {
  for (const caller of opened.splice(0)) {
    caller.human.close();
    caller.store.close();
  }
});

describe("a foreground caller's terminal", () => {
  it("asks a called run's gate, and shows its lines under the call", async () => {
    const caller = runStart(true);
    await asked(caller);
    await caller.term.press(KEY.enter);
    await caller.term.press(KEY.enter);

    await expect(caller.done).resolves.toMatchObject({ exitCode: 0 });
    await expect(Promise.all(caller.called)).resolves.toMatchObject([
      { exitCode: 0 },
    ]);
    expect(answeredBy(caller)).toMatchObject({
      answer: "approve",
      by: "terminal",
    });
    expect(caller.out).toContainEqual(expect.stringMatching(/^plan › /u));
  });

  it("stops the caller and the run it called on Ctrl-C at that prompt", async () => {
    const caller = runStart(true);
    await asked(caller);
    await caller.term.press(KEY.ctrlC);

    await expect(caller.done).resolves.toMatchObject({
      exitCode: 1,
      result: { status: "interrupted" },
    });
    await expect(Promise.all(caller.called)).resolves.toMatchObject([
      { result: { status: "interrupted" } },
    ]);
    expect(caller.out.join("\n")).not.toContain("still running");
  });

  it("names a called run still running when the caller ends", async () => {
    const caller = runStart(true, START_NO_WAIT);

    await expect(caller.done).resolves.toMatchObject({ exitCode: 0 });
    const plan = planRun(caller);
    expect(caller.out).toContain(
      `↳ run ${plan} still running · ork attach ${plan}`,
    );
    await gateOpen(caller);
    await answerDecision(caller.store, `${plan}-1`, "approve", caller.home);
    await expect(Promise.all(caller.called)).resolves.toMatchObject([
      { exitCode: 0 },
    ]);
  });

  it("leaves a called run's gate to ork decide with no one at the terminal", async () => {
    const caller = runStart(false);
    await gateOpen(caller);
    await vi.waitFor(() => {
      expect(caller.out).toContainEqual(
        expect.stringContaining("no terminal: answer with ork decide"),
      );
    });
    const [decision] = pendingDecisions(caller.store, {});
    await answerDecision(
      caller.store,
      String(decision?.id),
      "revise",
      caller.home,
    );

    await expect(caller.done).resolves.toMatchObject({ exitCode: 0 });
    expect(answeredBy(caller)).toMatchObject({
      answer: "revise",
      by: "decide",
    });
    expect(caller.term.screen().join("\n")).not.toContain("Approve the spec?");
  });
});
