/**
 * @file Tests for `--yolo`: the agreement (the warning, then `--yes` or the
 *   person's y/N; with no terminal only `--yes`), and through the CLI, that a
 *   refused start leaves no run, an agreed one records it and says so on its
 *   first line, and a resume without `--yolo` is not yolo.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, yoloOf } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { agreedToYolo, withYes, YOLO_NEEDS_YES } from "../src/run/yolo.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

/** A person who answers no, and one who answers yes. */
const no = (): Promise<boolean> => Promise.resolve(false);
const yes = (): Promise<boolean> => Promise.resolve(true);

/** `ork <args>` from source in `dir`, with `dir` as HOME and no terminal. */
const ork = (dir: string, args: string[]) =>
  spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: dir,
      ORK_PLAIN: "1",
      ORK_NO_UPDATE_CHECK: "1",
    },
    input: "",
  });

/** A git repository with `hi.ork.yaml`, one shell node running `command`. */
const project = (command: string): string => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-yolo-")));
  mkdirSync(path.join(dir, ".ork"));
  writeFileSync(
    path.join(dir, "hi.ork.yaml"),
    `schemaVersion: 1\nname: hi\nnodes:\n  say:\n    type: tool.shell\n    command: "${command}"\n`,
  );
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };
  git("init", "-q");
  git("add", "-A");
  git(
    "-c",
    "user.email=t@example.com",
    "-c",
    "user.name=t",
    "commit",
    "-qm",
    "i",
  );
  return dir;
};

/** Whether each start of the project's one run was yolo, in order. */
const startsOf = (dir: string): boolean[] => {
  const store = openStore(path.join(dir, ".ork", "state.db"));
  try {
    const [run] = store.runs();
    const events = store.events(run?.id ?? "").map(s => s.event);
    return events.flatMap((event, i) =>
      event.type === "run.started" ? [yoloOf(events.slice(0, i + 1))] : [],
    );
  } finally {
    store.close();
  }
};

describe("agreeing to --yolo", () => {
  it("refuses with no terminal and no --yes, before any warning", async () => {
    expect(await agreedToYolo({ yes: false, terminal: false })).toBe(false);
  });

  it("takes --yes without asking", async () => {
    const asked: string[] = [];
    const ask = (question: string): Promise<boolean> => {
      asked.push(question);
      return Promise.resolve(false);
    };
    expect(await agreedToYolo({ yes: true, terminal: true, ask })).toBe(true);
    expect(asked).toEqual([]);
  });

  it("asks on a terminal, and takes the answer", async () => {
    expect(await agreedToYolo({ yes: false, terminal: true, ask: no })).toBe(
      false,
    );
    expect(await agreedToYolo({ yes: false, terminal: true, ask: yes })).toBe(
      true,
    );
  });

  it("hands a detached copy --yes once", () => {
    expect(withYes(["run", "x", "--yolo"])).toEqual([
      "run",
      "x",
      "--yolo",
      "--yes",
    ]);
    expect(withYes(["run", "x", "-y"])).toEqual(["run", "x", "-y"]);
  });
});

describe("--yolo on the command line", () => {
  it("starts nothing without a terminal or --yes", () => {
    const dir = project("echo hi");
    const done = ork(dir, ["run", "hi.ork.yaml", "--yolo"]);
    expect(done.status).toBe(1);
    expect(done.stderr).toContain(YOLO_NEEDS_YES);
    expect(ork(dir, ["ps"]).stdout).toContain("No runs.");
  });

  it("records an agreed start, and says so on the run's first line", () => {
    const dir = project("echo hi");
    const done = ork(dir, ["run", "hi.ork.yaml", "--yolo", "-y"]);
    expect(done.status).toBe(0);
    expect(done.stderr).toContain("Yolo: every tool call");
    expect(done.stdout).toContain("(starts at say) · yolo");
    expect(startsOf(dir)).toEqual([true]);
  });

  it("resumes without yolo unless --yolo is given again", () => {
    const dir = project("false");
    ork(dir, ["run", "hi.ork.yaml", "--yolo", "--yes"]);
    ork(dir, ["resume"]);
    ork(dir, ["resume", "--yolo", "--yes"]);
    expect(startsOf(dir)).toEqual([true, false, true]);
  });
});
