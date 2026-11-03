/**
 * @file Tests for the real tool runner: aborting it ends the program and what
 *   it started, even when they ignore SIGTERM.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import { KILL_AFTER_MS, spawnTool } from "../src/index.ts";

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
    expect(run).toEqual({ exitCode: 3, stdout: "out\n", stderr: "err\n" });
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
