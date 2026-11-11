/**
 * @file Tests for `ork attach`: a live run followed to its end with the exit
 *   code of its status, Ctrl-C (at a prompt or not) detaching without stopping
 *   anything, an unknown or ambiguous id failing as `ork decide` does, no
 *   terminal following and saying once to use `ork decide`, and an ended run.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import {
  type EventStore,
  openStore,
  type RunEvent,
  storePath,
} from "@krapht/ork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attachSession } from "../src/commands/attach.ts";
import { fakeTerm, type FakeTerm, KEY } from "./term-fake.ts";

/** A bare environment with `home` as HOME, so the command reads that store. */
const envOf = (home: string): NodeJS.ProcessEnv => ({
  PATH: process.env["PATH"] ?? "",
  HOME: home,
  ORK_NO_UPDATE_CHECK: "1",
});

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const finished = (runId: string, status: "succeeded" | "failed"): RunEvent => ({
  type: "run.finished",
  result: { runId, status, costUsd: 0, nodes: [], reasons: [], worktrees: [] },
});

/** A run recorded by this process, so it reads as running until it ends. */
const begin = (store: EventStore, id: string): void => {
  store.begin({ id, workflow: "w", file: "f", project: "/p" });
  store.append(id, {
    type: "run.started",
    runId: id,
    workflow: "w",
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
    question: "Approve?",
    options,
  });
  store.append(run, {
    type: "decision.opened",
    node: "gate",
    decision: id,
    kind: "question",
    question: "Approve?",
    options,
  });
};

describe("ork attach, in process", () => {
  let store: EventStore;
  let term: FakeTerm;
  let lines: string[];
  let controller: AbortController;

  const session = (terminal: boolean) =>
    attachSession(store, "live0000", {
      out: line => {
        lines.push(stripVTControlCharacters(line));
      },
      intervalMs: 5,
      signal: controller.signal,
      ...(terminal
        ? {
            terminal: {
              input: term.io.input,
              output: term.io.output,
              interactive: true,
              env: {},
            },
          }
        : {}),
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
    begin(store, "live0000");
  });
  afterEach(() => {
    store.close();
  });

  it("follows a live run to its end and exits 0 when it succeeded", async () => {
    const done = session(true);
    await printed("run live0000");
    store.append("live0000", finished("live0000", "succeeded"));

    await expect(done).resolves.toBe(0);
  });

  it("exits 1 when the run failed", async () => {
    const done = session(true);
    await printed("run live0000");
    store.append("live0000", finished("live0000", "failed"));

    await expect(done).resolves.toBe(1);
  });

  it("detaches on Ctrl-C at a prompt: no stop, the decision stays open", async () => {
    open(store, "live0000", "live-1");
    const done = session(true);
    await vi.waitFor(() => {
      expect(term.screen().join("\n")).toContain("Approve?");
    });
    await term.press(KEY.ctrlC);

    await expect(done).resolves.toBe(0);
    expect(lines).toContain(
      "detached; run live0000 keeps going · ork attach live0000 · ork stop live0000",
    );
    expect(store.decision("live-1")?.status).toBe("open");
    expect(store.lookup("live0000")[0]?.status).toBe("running");
  });

  it("detaches on a signal when nothing is being asked", async () => {
    const done = session(true);
    await printed("run live0000");
    controller.abort();

    await expect(done).resolves.toBe(0);
    expect(lines.at(-1)).toContain("detached; run live0000 keeps going");
    expect(store.lookup("live0000")[0]?.status).toBe("running");
  });

  it("prints an ended run's whole transcript, the runs it called too, and exits with its status", async () => {
    store.append("live0000", {
      type: "call.started",
      node: "plan",
      run: "plan0000",
      workflow: "w",
      project: "/p",
    });
    begin(store, "plan0000");
    store.append("plan0000", finished("plan0000", "succeeded"));
    store.append("live0000", finished("live0000", "failed"));

    await expect(session(true)).resolves.toBe(1);
    expect(lines.some(line => line.startsWith("plan › "))).toBe(true);
    expect(term.screen()).toEqual([]);
  });
});

describe("ork attach, as a process", () => {
  let home: string;

  const ork = (args: readonly string[]) =>
    spawnSync(process.execPath, [BIN, ...args], {
      cwd: home,
      encoding: "utf8",
      env: envOf(home),
    });
  const seed = (body: (store: EventStore) => void): void => {
    const store = openStore(storePath(home));
    body(store);
    store.close();
  };

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "ork-attach-"));
  });

  it("fails on an unknown id and an ambiguous prefix as ork decide does", () => {
    seed(store => {
      begin(store, "abc00001");
      begin(store, "abc00002");
    });
    const unknown = ork(["attach", "zzz"]);
    const ambiguous = ork(["attach", "abc"]);

    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toBe(ork(["decide", "zzz"]).stderr);
    expect(ambiguous.status).toBe(1);
    expect(ambiguous.stderr).toBe(ork(["decide", "abc"]).stderr);
    expect(ambiguous.stderr).not.toBe("");
  });

  it("prints an ended run and exits with its status", () => {
    seed(store => {
      begin(store, "done0000");
      store.append("done0000", finished("done0000", "failed"));
    });
    const result = ork(["attach", "done0000"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("run done0000");
  });

  it("without a terminal follows a live run and says once to answer with ork decide", async () => {
    const store = openStore(storePath(home));
    begin(store, "live0000");
    open(store, "live0000", "live-1");
    open(store, "live0000", "live-2");
    const child = spawn(process.execPath, [BIN, "attach", "live0000"], {
      cwd: home,
      stdio: ["ignore", "pipe", "pipe"],
      env: envOf(home),
    });
    let stdout = "";
    child.stdout.on("data", chunk => {
      stdout += String(chunk);
    });
    const exited = new Promise<number | null>(resolve => {
      child.on("close", resolve);
    });
    await vi.waitFor(
      () => {
        expect(stdout).toContain("no terminal: answer with ork decide");
      },
      { timeout: 10_000 },
    );
    store.append("live0000", finished("live0000", "succeeded"));

    await expect(exited).resolves.toBe(0);
    expect(stdout.split("no terminal: answer with ork decide")).toHaveLength(2);
    expect(store.decision("live-1")?.status).toBe("open");
    store.close();
  });
});
