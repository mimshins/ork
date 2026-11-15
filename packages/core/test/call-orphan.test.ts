/**
 * @file What a SIGKILLed caller leaves of a `workflow.call` (measured, not
 *   designed: ADR-087 guards a node's tools, not called runs). A stand-in
 *   caller starts a called run through `createCalls` and the real `detachRun`,
 *   with a stub `ork` script; the test kills the caller and pins that the
 *   called run goes on. Then a stand-in `ork resume` of the caller pins what
 *   specs/scheduler/calls.md "Resuming" says: it attaches to the called run
 *   still running, and resumes one that ended. POSIX only.
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EventStore,
  liveStatus,
  openStore,
  type RunRecord,
} from "../src/index.ts";

const posix = process.platform !== "win32";

const HOST = path.join(import.meta.dirname, "fixtures/call-host.ts");

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Kills `pid`'s process group, or the process when it leads none. */
const killHard = (pid: number): void => {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      // Already gone, or not a group leader.
    }
  }
};

const exited = (child: ChildProcess): Promise<void> =>
  new Promise(resolve => {
    child.once("exit", () => {
      resolve();
    });
  });

let dir: string;
let root: string;
let file: string;
let store: EventStore;
const pids: number[] = [];

/** Runs the stand-in caller in `mode`, with the test's store. */
const host = (...args: string[]): ChildProcess => {
  const child = spawn(process.execPath, [HOST, ...args], {
    stdio: "ignore",
    env: { ...process.env, ORK_TEST_STORE: file },
  });
  pids.push(child.pid ?? 0);
  return child;
};

/** The stored run `id`. */
const runOf = (id: string): RunRecord => {
  const [run] = store.lookup(id);
  if (run === undefined) throw new Error(`no run ${id}`);
  return run;
};

/** Its run's process, ended in `afterEach`. */
const tracked = (run: RunRecord): RunRecord => {
  pids.push(run.pid);
  return run;
};

/** The types of run `id`'s events. */
const typesOf = (id: string): string[] =>
  store.events(id).map(e => e.event.type);

/** The called run, once its process has recorded it. */
const calledRun = async (): Promise<RunRecord> => {
  await vi.waitFor(
    () => {
      expect(store.lookup("called01")).toHaveLength(1);
    },
    { timeout: 15_000 },
  );
  return tracked(runOf("called01"));
};

/** A caller that started its call and was then SIGKILLed. */
const killedCaller = async (): Promise<RunRecord> => {
  const caller = host("call", root);
  const called = await calledRun();
  await vi.waitFor(() => {
    expect(typesOf("caller00")).toContain("call.started");
  });
  const gone = exited(caller);
  caller.kill("SIGKILL");
  await gone;
  return called;
};

/** The caller resumed, and its call's result. */
const resumedCaller = async (): Promise<unknown> => {
  const out = path.join(dir, "result.json");
  const resumer = host("resume", root, out);
  await exited(resumer);
  return JSON.parse(readFileSync(out, "utf8"));
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ork-call-orphan-"));
  root = path.join(dir, "app");
  mkdirSync(path.join(root, ".ork", "workflows"), { recursive: true });
  writeFileSync(path.join(root, ".ork", "workflows", "feature.ork.yaml"), "x");
  file = path.join(dir, "state.db");
  store = openStore(file);
});

afterEach(() => {
  for (const pid of pids.splice(0)) if (pid > 0) killHard(pid);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!posix)("a called run when its caller is SIGKILLed", () => {
  it("outlives the caller, which reads as crashed", async () => {
    const called = await killedCaller();
    // Longer than the orphan guard's grace: nothing comes to end it.
    await sleep(1500);
    expect(isAlive(called.pid)).toBe(true);
    expect(runOf("called01").parent).toBe("caller00");
    expect(liveStatus(runOf("called01"))).toBe("running");
    expect(liveStatus(runOf("caller00"))).toBe("crashed");
  }, 30_000);

  it("is attached to again, not restarted, when the caller resumes and it still runs", async () => {
    const called = await killedCaller();
    const result = await resumedCaller();
    expect(result).toMatchObject({ ok: true, output: { run: "called01" } });
    expect(runOf("called01").pid).toBe(called.pid);
    expect(typesOf("called01")).not.toContain("run.resumed");
    // No second call was started.
    expect(typesOf("caller00").filter(t => t === "call.started")).toHaveLength(
      1,
    );
  }, 30_000);

  it("is resumed when the caller resumes after it ended", async () => {
    const called = await killedCaller();
    killHard(called.pid);
    await vi.waitFor(() => {
      expect(liveStatus(runOf("called01"))).toBe("crashed");
    });
    const result = await resumedCaller();
    expect(result).toMatchObject({ ok: true, output: { run: "called01" } });
    const after = tracked(runOf("called01"));
    expect(after.pid).not.toBe(called.pid);
    expect(liveStatus(after)).toBe("running");
    expect(typesOf("called01")).toContain("run.resumed");
  }, 30_000);
});
