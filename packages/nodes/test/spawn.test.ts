/**
 * @file Tests for the real tool runner: aborting it ends the program and what
 *   it started, even when they ignore SIGTERM; the CPU it used, and the
 *   priority it starts at.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { constants, getPriority, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import { KILL_AFTER_MS, spawnTool, type ToolRun } from "../src/index.ts";

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A shell that writes its pid and its child's, then waits. */
const script = (file: string, ignoreTerm: boolean): string =>
  `${ignoreTerm ? "trap '' TERM; " : ""}sleep 60 & echo $$ $! > ${file}; wait; sleep 60`;

const started = async (file: string): Promise<number[]> => {
  await vi.waitFor(() => {
    expect(readFileSync(file, "utf8")).toMatch(/\d+ \d+\n/u);
  });
  return readFileSync(file, "utf8").trim().split(" ").map(Number);
};

const abortedRun = async (ignoreTerm: boolean) => {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "ork-spawn-")),
    "pids",
  );
  const abort = new AbortController();
  const running = spawnTool("sh", ["-c", script(file, ignoreTerm)], {
    cwd: tmpdir(),
    signal: abort.signal,
  });
  const pids = await started(file);
  abort.abort();
  const run = await running;
  return { run, pids };
};

/** All the CPU a run used, or 0 when the runner said none. */
const cpuMs = (run: ToolRun): number =>
  (run.cpu?.userMs ?? 0) + (run.cpu?.systemMs ?? 0);

/** The priority a program started at, as it reads its own. */
const niceOf = async (priority: "low" | "normal"): Promise<number> => {
  const run = await spawnTool(
    process.execPath,
    ["-e", "console.log(require('node:os').getPriority())"],
    { cwd: tmpdir(), signal: new AbortController().signal, priority },
  );
  return Number(run.stdout.trim());
};

/**
 * A `low` child's priority: `PRIORITY_BELOW_NORMAL` below Ork's, held at
 * `nice`'s lowest (20 on macOS, 19 elsewhere) when Ork already runs low.
 */
const lowered = (own: number): number =>
  Math.min(
    own + constants.priority.PRIORITY_BELOW_NORMAL,
    process.platform === "darwin" ? 20 : 19,
  );

describe("spawnTool", () => {
  it("collects output and the exit code", async () => {
    const run = await spawnTool(
      "sh",
      ["-c", "echo out; echo err >&2; exit 3"],
      {
        cwd: tmpdir(),
        signal: new AbortController().signal,
      },
    );
    expect(run).toMatchObject({
      exitCode: 3,
      stdout: "out\n",
      stderr: "err\n",
    });
  });

  it("says the CPU the program and its children used", async () => {
    // A child of the program spins until it has used 300 ms of CPU.
    const spin =
      "const s = process.cpuUsage(); while (process.cpuUsage(s).user < 300000) {}";
    const run = await spawnTool(
      "sh",
      ["-c", `${JSON.stringify(process.execPath)} -e '${spin}'`],
      { cwd: tmpdir(), signal: new AbortController().signal },
    );
    expect(run.exitCode).toBe(0);
    expect(cpuMs(run)).toBeGreaterThanOrEqual(250);
  });

  it("starts the program below Ork's priority under `low` only", async () => {
    const own = getPriority();
    expect(await niceOf("low")).toBe(lowered(own));
    expect(await niceOf("normal")).toBe(own);
  });

  it("reports a program that cannot start", async () => {
    const run = await spawnTool("no-such-program-for-ork", [], {
      cwd: tmpdir(),
      signal: new AbortController().signal,
    });
    expect(run.exitCode).toBe(-1);
    expect(run.stderr).toContain("could not run no-such-program-for-ork");
  });

  it("does not start when already aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    const run = await spawnTool("sh", ["-c", "echo ran"], {
      cwd: tmpdir(),
      signal: abort.signal,
    });
    expect(run.stdout).toBe("");
    expect(run.exitCode).toBe(-1);
  });

  it("ends a program and what it started when aborted", async () => {
    const { run, pids } = await abortedRun(false);
    expect(run.exitCode).toBe(-1);
    await vi.waitFor(() => {
      expect(pids.filter(pid => isAlive(pid))).toEqual([]);
    });
  });

  it(
    "kills what ignores SIGTERM",
    async () => {
      const before = Date.now();
      const { pids } = await abortedRun(true);
      expect(Date.now() - before).toBeGreaterThanOrEqual(KILL_AFTER_MS);
      await sleep(50);
      await vi.waitFor(() => {
        expect(pids.filter(pid => isAlive(pid))).toEqual([]);
      });
    },
    KILL_AFTER_MS + 5000,
  );
});
