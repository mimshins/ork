/**
 * @file Tests for a session's process lifetime off Windows: when `ork` is
 *   SIGKILLed, the driver and what it started end with it (the orphan guard);
 *   Ctrl-C to `ork` still stops the driver through its handler, with SIGINT to
 *   the driver's own pid; a session that ends normally leaves its leftovers
 *   alone, even after `ork` dies.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

const posix = process.platform !== "win32";

/** A stand-in for `ork run` that runs one session. */
const HOST = path.join(import.meta.dirname, "fixtures/orphan-session-host.ts");

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const kill = (pid: number): void => {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
};

const left: number[] = [];

afterEach(() => {
  for (const pid of left.splice(0)) kill(pid);
});

/** Starts the host in `mode`; returns it and the file its driver writes. */
const hosted = (mode: "wait" | "end"): { host: ChildProcess; file: string } => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "ork-leg-")), "pids");
  const host = spawn(process.execPath, [HOST, mode, file], { stdio: "ignore" });
  if (host.pid !== undefined) left.push(host.pid);
  return { host, file };
};

/** The pids in `file`, once it matches `pattern`; each is killed after. */
const pidsOnce = async (file: string, pattern: RegExp): Promise<number[]> => {
  await vi.waitFor(
    () => {
      expect(readFileSync(file, "utf8")).toMatch(pattern);
    },
    { timeout: 5000 },
  );
  const pids = (readFileSync(file, "utf8").match(/\d+/gu) ?? []).map(Number);
  left.push(...pids);
  return pids;
};

describe.skipIf(!posix)("a session's processes", () => {
  it("end with ork when it is SIGKILLed", async () => {
    const { host, file } = hosted("wait");
    const pids = await pidsOnce(file, /\d+ \d+/u);
    expect(pids.filter(pid => isAlive(pid))).toHaveLength(2);
    host.kill("SIGKILL");
    await vi.waitFor(
      () => {
        expect(pids.filter(pid => isAlive(pid))).toEqual([]);
      },
      { timeout: 3000 },
    );
  }, 10_000);

  it("stop with SIGINT to the driver when ork is interrupted", async () => {
    const { host, file } = hosted("wait");
    const [driver = 0] = await pidsOnce(file, /\d+ \d+/u);
    // Only `ork` hears it: the driver is in its own group, as after a Ctrl-C.
    host.kill("SIGINT");
    await vi.waitFor(
      () => {
        expect(readFileSync(file, "utf8")).toContain("interrupted");
        expect(isAlive(driver)).toBe(false);
        // The guard's pipe does not keep `ork` up once the session is over.
        expect(host.exitCode).toBe(0);
      },
      { timeout: 5000 },
    );
  }, 10_000);

  it("leave a leftover alone when the session ends, even after ork dies", async () => {
    const { host, file } = hosted("end");
    const [leftover = 0] = await pidsOnce(file, /ended/u);
    host.kill("SIGKILL");
    await sleep(500);
    expect(isAlive(leftover)).toBe(true);
  }, 10_000);
});
