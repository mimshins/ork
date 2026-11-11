/**
 * @file Tests for `attachRun`: a call chain printed under its call paths (runs
 *   called before attaching too), a called run's decision answered on the
 *   terminal, a prompt withdrawn when the decision closes elsewhere, a late
 *   answer refused, no terminal, an ended run, a called run still running, and
 *   a detach that closes nothing.
 */

import { spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

import { type EventStore, openStore, type RunEvent } from "@krapht/ork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTerminalHuman } from "../src/human.ts";
import { type Attached, attachRun } from "../src/runs/attach.ts";
import { fakeTerm, type FakeTerm, KEY } from "./term-fake.ts";

const started = (runId: string): RunEvent => ({
  type: "run.started",
  runId,
  workflow: "w",
  entries: [],
  nodes: [{ id: "gate", type: "human.gate" }],
});

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

const called = (node: string, run: string): RunEvent => ({
  type: "call.started",
  node,
  run,
  workflow: "w",
  project: "/p",
});

describe("attachRun", () => {
  let store: EventStore;
  let term: FakeTerm;
  let lines: string[];

  /** A run recorded in this process, so it reads as running until it ends. */
  const begin = (id: string): void => {
    store.begin({ id, workflow: "w", file: "f", project: "/p" });
    store.append(id, started(id));
  };
  /** A decision of `run`'s node `gate`, opened and announced as the run does. */
  const open = (run: string, id: string): void => {
    store.openDecision({
      id,
      runId: run,
      node: "gate",
      kind: "question",
      question: "Approve the spec?",
      options: [{ id: "approve" }, { id: "revise" }],
    });
    store.append(run, {
      type: "decision.opened",
      node: "gate",
      decision: id,
      kind: "question",
      question: "Approve the spec?",
      options: [{ id: "approve" }, { id: "revise" }],
    });
  };
  /** What another answerer does: stores the answer, and the run says so. */
  const answerElsewhere = (
    run: string,
    id: string,
    announce: boolean,
  ): void => {
    store.answerDecision(id, "revise", "decide");
    if (!announce) return;
    store.append(run, {
      type: "decision.answered",
      node: "gate",
      decision: id,
      answer: "revise",
      by: "decide",
    });
  };
  /** The chain `root → plan → spec`, with `spec` waiting on `spec-1`. */
  const chain = (): void => {
    begin("root0000");
    store.append("root0000", called("plan", "plan0000"));
    begin("plan0000");
    store.append("plan0000", called("spec", "spec0000"));
    begin("spec0000");
    open("spec0000", "spec-1");
  };
  const endAll = (): void => {
    for (const id of ["spec0000", "plan0000", "root0000"]) {
      store.append(id, finished(id));
    }
  };
  const human = () =>
    createTerminalHuman({
      input: term.io.input,
      output: term.io.output,
      interactive: true,
      env: {},
    });
  const attach = (
    options: Parameters<typeof attachRun>[3] = {},
  ): Promise<Attached> =>
    attachRun(
      store,
      "root0000",
      line => {
        lines.push(stripVTControlCharacters(line));
      },
      { intervalMs: 5, ...options },
    );
  const screenHas = (text: string) =>
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
  });
  afterEach(() => {
    store.close();
  });

  it("prints a whole ended chain under call paths and asks nothing", async () => {
    chain();
    endAll();
    const asked = await attach({ human: human() });

    expect(asked).toEqual({ stillRunning: [], exitCode: 0 });
    expect(lines.filter(line => line.startsWith("plan › spec › "))).not.toEqual(
      [],
    );
    expect(lines.filter(line => line.startsWith("plan › "))).not.toEqual([]);
    expect(
      lines.filter(line => line.includes("started w as run plan0000")),
    ).toHaveLength(1);
    expect(lines.some(line => line.startsWith("root0000"))).toBe(false);
    expect(term.screen()).toEqual([]);
    expect(store.decision("spec-1")?.status).toBe("open");
  });

  it("asks a called run's open decision, stores it as the terminal's and goes on", async () => {
    chain();
    const done = attach({ human: human() });
    await screenHas("Approve the spec?");
    await screenHas("plan › spec");
    await term.press(KEY.down, KEY.enter);
    await vi.waitFor(() => {
      expect(store.decision("spec-1")?.status).toBe("answered");
    });
    endAll();

    await expect(done).resolves.toMatchObject({ exitCode: 0 });
    expect(store.decision("spec-1")).toMatchObject({
      answer: "revise",
      answeredBy: "terminal",
    });
  });

  it("withdraws the prompt when the decision is answered elsewhere, and says who", async () => {
    chain();
    const done = attach({ human: human() });
    await screenHas("Approve the spec?");
    answerElsewhere("spec0000", "spec-1", true);
    await printed("spec-1 answered elsewhere: revise (ork decide)");
    endAll();

    await done;
    expect(store.decision("spec-1")?.answeredBy).toBe("decide");
  });

  it("refuses a late answer with the store's message and keeps the first", async () => {
    chain();
    const done = attach({ human: human() });
    await screenHas("Approve the spec?");
    answerElsewhere("spec0000", "spec-1", false);
    await term.press(KEY.enter);
    await printed("! spec-1 was already answered: revise (decide)");
    endAll();

    await done;
    expect(store.decision("spec-1")).toMatchObject({
      answer: "revise",
      answeredBy: "decide",
    });
  });

  it("withdraws the prompt and says so when the decision is withdrawn", async () => {
    chain();
    const done = attach({ human: human() });
    await screenHas("Approve the spec?");
    store.withdrawDecision("spec-1");
    store.append("spec0000", {
      type: "decision.withdrawn",
      node: "gate",
      decision: "spec-1",
    });
    await printed("spec-1 withdrawn");
    endAll();

    await done;
    expect(store.decision("spec-1")?.status).toBe("withdrawn");
  });

  it("asks two open decisions in the order they opened", async () => {
    chain();
    open("spec0000", "spec-2");
    const done = attach({ human: human() });
    await screenHas("Approve the spec?");
    await term.press(KEY.enter);
    await vi.waitFor(() => {
      expect(store.decision("spec-1")?.status).toBe("answered");
    });
    await term.press(KEY.down, KEY.enter);
    await vi.waitFor(() => {
      expect(store.decision("spec-2")?.status).toBe("answered");
    });
    endAll();

    await done;
    expect(store.decision("spec-1")?.answer).toBe("approve");
    expect(store.decision("spec-2")?.answer).toBe("revise");
  });

  it("says what ork logs says and exits 1 when the root's process is gone", async () => {
    begin("root0000");
    const gone = spawnSync("true").pid;
    const crashed: EventStore = {
      ...store,
      lookup: id =>
        store.lookup(id).map(run => Object.assign({}, run, { pid: gone })),
    };

    await expect(
      attachRun(
        crashed,
        "root0000",
        line => {
          lines.push(stripVTControlCharacters(line));
        },
        { intervalMs: 5 },
      ),
    ).resolves.toMatchObject({ exitCode: 1 });
    expect(lines).toContain(
      "run root0000 stopped without finishing (its process is gone)",
    );
  });

  it("exits 1 when the root was stopped without finishing", async () => {
    begin("root0000");
    const stopped: EventStore = {
      ...store,
      lookup: id =>
        store
          .lookup(id)
          .map(run =>
            Object.assign({}, run, { status: "interrupted" as const }),
          ),
    };

    await expect(
      attachRun(
        stopped,
        "root0000",
        line => {
          lines.push(line);
        },
        { intervalMs: 5 },
      ),
    ).resolves.toEqual({ stillRunning: [], exitCode: 1 });
  });

  it("without a terminal follows, never asks, and says to use ork decide once", async () => {
    chain();
    open("spec0000", "spec-2");
    const done = attach({ hintNoTerminal: true });
    await printed("spec-2");
    endAll();

    await done;
    expect(
      lines.filter(line =>
        line.includes("no terminal: answer with ork decide"),
      ),
    ).toHaveLength(1);
    expect(store.decision("spec-1")?.status).toBe("open");
    expect(store.decision("spec-2")?.status).toBe("open");
  });

  it("names a called run still running when the root ends, and exits 0", async () => {
    begin("root0000");
    store.append("root0000", called("plan", "plan0000"));
    begin("plan0000");
    store.append("root0000", finished("root0000"));

    await expect(attach()).resolves.toEqual({
      stillRunning: ["plan0000"],
      exitCode: 0,
    });
    expect(lines).toContain(
      "↳ run plan0000 still running · ork attach plan0000",
    );
  });

  it("exits 1 when the root did not succeed", async () => {
    begin("root0000");
    store.append("root0000", {
      type: "run.finished",
      result: {
        runId: "root0000",
        status: "failed",
        costUsd: 0,
        nodes: [],
        reasons: [],
        worktrees: [],
      },
    });

    await expect(attach()).resolves.toMatchObject({ exitCode: 1 });
  });

  it("leaves the run and its open decisions alone when the signal aborts", async () => {
    chain();
    const controller = new AbortController();
    const done = attach({ human: human(), signal: controller.signal });
    await screenHas("Approve the spec?");
    controller.abort();

    await expect(done).resolves.toMatchObject({ exitCode: 0 });
    expect(store.decision("spec-1")?.status).toBe("open");
    expect(store.lookup("root0000")[0]?.status).toBe("running");
  });
});
