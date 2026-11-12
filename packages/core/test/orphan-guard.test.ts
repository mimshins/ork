/**
 * @file Tests for the orphan guard: when `ork`'s end of the pipe closes, the
 *   watcher ends its whole group, with SIGKILL for what ignores SIGTERM; a line
 *   on the pipe releases it and leaves the group running. POSIX only.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { holdGuard, KILL_AFTER_MS, orphanGuard } from "../src/index.ts";

const posix = process.platform !== "win32";

/** Whether any process is left in group `pgid`. */
const groupAlive = (pgid: number): boolean => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The signal that ended `child`. */
const exitOf = (child: ChildProcess): Promise<NodeJS.Signals | null> =>
  new Promise(resolve => {
    child.on("exit", (_code, signal) => {
      resolve(signal);
    });
  });

const started: ChildProcess[] = [];

/** A group led by `sh` running the guard on fd 3 beside a long `sleep`. */
const guarded = (prefix = ""): { child: ChildProcess; pgid: number } => {
  const child = spawn(
    "sh",
    ["-c", `${prefix}${orphanGuard(3)} sleep 30 & wait`],
    { detached: true, stdio: ["ignore", "ignore", "ignore", "pipe"] },
  );
  started.push(child);
  return { child, pgid: child.pid ?? 0 };
};

afterEach(() => {
  for (const child of started.splice(0)) {
    try {
      process.kill(-(child.pid ?? 0), "SIGKILL");
    } catch {
      // Already gone.
    }
  }
});

describe.skipIf(!posix)("orphanGuard", () => {
  it(
    "ends its group when ork's end of the pipe closes",
    async () => {
      const { child, pgid } = guarded();
      holdGuard(child.stdio[3]);
      const ended = exitOf(child);
      expect(groupAlive(pgid)).toBe(true);
      child.stdio[3]?.destroy();
      expect(await ended).toBe("SIGTERM");
      // The watcher itself stays in the group through the grace.
      await vi.waitFor(
        () => {
          expect(groupAlive(pgid)).toBe(false);
        },
        { timeout: KILL_AFTER_MS + 1000 },
      );
    },
    KILL_AFTER_MS + 5000,
  );

  it(
    "kills what ignores SIGTERM after the grace",
    async () => {
      const { child, pgid } = guarded("trap '' TERM; ");
      holdGuard(child.stdio[3]);
      const ended = exitOf(child);
      const before = Date.now();
      child.stdio[3]?.destroy();
      expect(await ended).toBe("SIGKILL");
      await vi.waitFor(
        () => {
          expect(groupAlive(pgid)).toBe(false);
        },
        { timeout: KILL_AFTER_MS + 2000 },
      );
      expect(Date.now() - before).toBeGreaterThanOrEqual(KILL_AFTER_MS - 100);
    },
    KILL_AFTER_MS + 5000,
  );

  it("leaves the group alone once released", async () => {
    const { child, pgid } = guarded();
    const release = holdGuard(child.stdio[3]);
    release();
    await sleep(200);
    child.stdio[3]?.destroy();
    await sleep(500);
    expect(groupAlive(pgid)).toBe(true);
  });
});
