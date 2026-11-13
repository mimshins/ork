/**
 * @file Tests `kit.ts stop` and `sweep`: a live run is stopped through `ork`, a
 *   process started from `<root>/bin` is ended, the root is removed, and a path
 *   that is not a kit root under the temp folder is refused and left alone.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { realTmp } from "../roots.ts";
import { ROOT_MARKER } from "../setup.ts";
import { type RunOrk, stopKit, sweepDir } from "../stop.ts";

const made: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
  }
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh folder under the temp folder. */
const folder = (): string => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-qa-stop-")));
  made.push(dir);
  return dir;
};

/** A kit root (marker, `home/`, `bin/`) inside `parent`. */
const rootIn = (parent: string, name = "tester"): string => {
  const root = path.join(parent, name);
  mkdirSync(path.join(root, "home"), { recursive: true });
  mkdirSync(path.join(root, "bin"));
  writeFileSync(path.join(root, ROOT_MARKER), "");
  return root;
};

/**
 * Starts a process from `<root>/bin`, once it runs, and returns it with a
 * promise of its end.
 */
const sleeper = async (root: string): Promise<Started> => {
  const script = path.join(root, "bin", "sleeper.mjs");
  writeFileSync(
    script,
    'console.log("ready");\nsetInterval(() => {}, 1000);\n',
  );
  const child = spawn(process.execPath, [script], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  children.push(child);
  const ended = once(child, "exit");
  await once(child.stdout, "data");
  return { child, ended };
};

type Started = { child: ChildProcess; ended: Promise<unknown> };

const noOrk: RunOrk = () => {
  throw new Error("ork: command not found");
};

/** An `ork` that lists one running and one finished run, and records its calls. */
const listing =
  (calls: string[]): RunOrk =>
  (_root, args) => {
    calls.push(args.join(" "));
    return JSON.stringify([
      { id: "run-live", status: "running" },
      { id: "run-done", status: "succeeded" },
    ]);
  };

describe("stopKit", () => {
  it("stops live runs, ends what carries the root, and removes it", async () => {
    const root = rootIn(folder());
    const { ended } = await sleeper(root);
    const calls: string[] = [];
    const message = stopKit(root, { ork: listing(calls) });
    await ended;
    expect(calls).toEqual([
      "ps --json --project all --limit 100000",
      "stop run-live",
    ]);
    expect(message).toContain("Stopped 1 run(s)");
    expect(existsSync(root)).toBe(false);
  });

  it("goes on when `ork` is missing", async () => {
    const root = rootIn(folder());
    const { ended } = await sleeper(root);
    stopKit(root, { ork: noOrk });
    await ended;
    expect(existsSync(root)).toBe(false);
  });

  it("leaves a process of another folder alone", async () => {
    const parent = folder();
    const other = rootIn(parent, "other");
    const { child } = await sleeper(other);
    const root = rootIn(parent);
    stopKit(root, { ork: noOrk });
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
  });

  it("refuses a folder with no marker, and leaves it", () => {
    const dir = folder();
    expect(() => stopKit(dir, { ork: noOrk })).toThrow("not a QA kit root");
    expect(existsSync(dir)).toBe(true);
  });

  it("refuses the temp folder, a path outside it, and a relative path", () => {
    expect(() => stopKit(realTmp(), { ork: noOrk })).toThrow("not inside");
    expect(() => stopKit("/", { ork: noOrk })).toThrow("not inside");
    expect(() => stopKit("home", { ork: noOrk })).toThrow("not an absolute");
  });
});

describe("sweepDir", () => {
  it("stops every kit root in the folder and removes the folder", async () => {
    const dir = folder();
    const first = rootIn(dir, "one");
    const second = rootIn(dir, "two");
    writeFileSync(path.join(dir, "ork.tgz"), "");
    const ended = [(await sleeper(first)).ended, (await sleeper(second)).ended];
    sweepDir(dir, { ork: noOrk });
    await Promise.all(ended);
    expect(existsSync(dir)).toBe(false);
  });

  it("removes a folder that holds only a tarball", () => {
    const dir = folder();
    writeFileSync(path.join(dir, "ork.tgz"), "");
    sweepDir(dir, { ork: noOrk });
    expect(existsSync(dir)).toBe(false);
  });

  it("refuses a folder with no kit root and no tarball, and keeps it", () => {
    const dir = folder();
    writeFileSync(path.join(dir, "notes.txt"), "");
    expect(() => sweepDir(dir, { ork: noOrk })).toThrow("no kit root");
    expect(existsSync(dir)).toBe(true);
  });

  it("refuses the temp folder and a path outside it", () => {
    expect(() => sweepDir(realTmp(), { ork: noOrk })).toThrow("not inside");
    expect(() => sweepDir("/", { ork: noOrk })).toThrow("not inside");
  });
});
