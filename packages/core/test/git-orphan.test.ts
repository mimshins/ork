/**
 * @file What a SIGKILLed `ork` leaves of a `git` it was running (measured, not
 *   designed: `git.ts` runs git in `ork`'s own process group, outside the
 *   orphan guard of ADR-087). A stand-in host commits through `git()` in a temp
 *   repository whose `pre-commit` hook waits for the test; the test kills the
 *   host and pins that git and its hook run on (without `.git/index.lock`,
 *   which `commit -m` lets go before its hooks), that the commit lands once the
 *   hook ends, and that a git killed meanwhile leaves no lock and no commit,
 *   only the staged change. POSIX only.
 */

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posix = process.platform !== "win32";

const HOST = path.join(import.meta.dirname, "fixtures/git-host.ts");

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

const sh = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

let dir: string;
let repo: string;
let pidsFile: string;
let go: string;
let lock: string;
const pids: number[] = [];

/** The host, killed once git's hook has started: the hook's pid and git's. */
const killedHost = async (): Promise<{ hook: number; git: number }> => {
  const host: ChildProcess = spawn(process.execPath, [HOST, repo], {
    stdio: "ignore",
  });
  pids.push(host.pid ?? 0);
  await vi.waitFor(
    () => {
      expect(readFileSync(pidsFile, "utf8")).toMatch(/^\d+ \d+\n/u);
    },
    { timeout: 10_000 },
  );
  const [hook = 0, git = 0] = readFileSync(pidsFile, "utf8")
    .trim()
    .split(" ")
    .map(Number);
  pids.push(hook, git);
  const gone = new Promise(resolve => {
    host.once("exit", resolve);
  });
  host.kill("SIGKILL");
  await gone;
  return { hook, git };
};

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-git-orphan-")));
  repo = path.join(dir, "repo");
  pidsFile = path.join(dir, "pids");
  go = path.join(dir, "go");
  sh(dir, "init", "-q", "repo");
  sh(repo, "config", "user.name", "Test");
  sh(repo, "config", "user.email", "test@example.com");
  sh(repo, "config", "core.hooksPath", path.join(repo, ".git", "hooks"));
  const hook = path.join(repo, ".git", "hooks", "pre-commit");
  writeFileSync(
    hook,
    `#!/bin/sh\necho $$ $PPID > "${pidsFile}"\nwhile [ ! -f "${go}" ]; do sleep 0.1; done\n`,
  );
  chmodSync(hook, 0o755);
  writeFileSync(path.join(repo, "a.txt"), "a\n");
  sh(repo, "add", "a.txt");
  lock = path.join(repo, ".git", "index.lock");
});

afterEach(() => {
  writeFileSync(go, "");
  for (const pid of pids.splice(0)) if (pid > 0) kill(pid);
  rmSync(dir, { recursive: true, force: true });
});

/** Commits on the repository's branch. */
const commits = (): string => sh(repo, "rev-list", "--all", "--count").trim();

describe.skipIf(!posix)("a git commit when ork is SIGKILLed", () => {
  it("runs on with its hook, not holding the index's lock", async () => {
    const { hook, git } = await killedHost();
    await sleep(500);
    expect(isAlive(git)).toBe(true);
    expect(isAlive(hook)).toBe(true);
    // `commit -m` writes the index and lets its lock go before the hook.
    expect(existsSync(lock)).toBe(false);
  }, 20_000);

  it("lands the commit once its hook ends", async () => {
    const { git } = await killedHost();
    writeFileSync(go, "");
    await vi.waitFor(
      () => {
        expect(isAlive(git)).toBe(false);
      },
      { timeout: 5000 },
    );
    expect(sh(repo, "log", "--format=%s")).toBe("work\n");
    expect(existsSync(lock)).toBe(false);
  }, 20_000);

  it("leaves no lock and no commit, only the staged change, when killed in its hook", async () => {
    const { hook, git } = await killedHost();
    kill(git);
    kill(hook);
    await vi.waitFor(() => {
      expect(isAlive(git)).toBe(false);
    });
    expect(existsSync(lock)).toBe(false);
    expect(commits()).toBe("0");
    expect(sh(repo, "diff", "--cached", "--name-only")).toBe("a.txt\n");
  }, 20_000);
});
