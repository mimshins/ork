/**
 * @file Tests for tab completion's live values, read from a project and a store
 *   in a temporary home: workflows, runs newest first with workflow and status,
 *   a run's or a workflow's nodes, open decisions; the store is only read
 *   (never created, never changed, refused at another version), errors print
 *   nothing, and 500 runs don't slow it down.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CommandDef } from "citty";
import { describe, expect, it, vi } from "vitest";

import { completionLines, main, printCompletions } from "../src/index.ts";
import { seedStore, tempDir } from "./fixtures/completion.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

/** The candidates' lines (values and descriptions) for `words`. */
const offered = async (
  seeded: { project: string; storeFile: string },
  ...words: string[]
): Promise<string[]> =>
  (await completionLines(main, words, seeded.project, seeded.storeFile)).filter(
    line => !line.startsWith(":"),
  );

const valuesOf = (lines: readonly string[]): string[] =>
  lines.map(line => line.split("\t")[0] ?? "");

/** `ork __complete -- <words…>` run as a program, in a home of its own. */
const spawnComplete = (home: string, cwd: string, words: string[]) =>
  spawnSync(process.execPath, [BIN, "__complete", "--", ...words], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", HOME: home },
  });

/** What printCompletions writes to stdout. */
const printed = async (root: CommandDef, words: string[]): Promise<string> => {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    await printCompletions(root, ["--", ...words]);
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
};

describe("completion values", () => {
  it("offers the project's workflows, then Ork's own", async () => {
    const seeded = seedStore();
    expect(valuesOf(await offered(seeded, "run", ""))).toEqual([
      "hello",
      "ork:feedback-apply",
    ]);
    expect(valuesOf(await offered(seeded, "validate", "h"))).toEqual(["hello"]);
  });

  it("offers the project's runs newest first, with workflow and status", async () => {
    const seeded = seedStore();
    expect(await offered(seeded, "logs", "")).toEqual([
      "live1\thello · running",
      "done1\thello · succeeded",
    ]);
    expect(valuesOf(await offered(seeded, "stop", "d"))).toEqual(["done1"]);
  });

  it("offers another project's run by its prefix", async () => {
    const seeded = seedStore();
    expect(valuesOf(await offered(seeded, "tree", "oth"))).toEqual(["other1"]);
  });

  it("offers a run's nodes, the newest run's when none is given", async () => {
    const seeded = seedStore();
    expect(
      valuesOf(await offered(seeded, "logs", "live1", "--node", "")),
    ).toEqual(["plan", "build"]);
    expect(valuesOf(await offered(seeded, "pause", "--node", "b"))).toEqual([
      "build",
    ]);
    expect(valuesOf(await offered(seeded, "chat", "live1", ""))).toEqual([
      "plan",
      "build",
    ]);
  });

  it("offers a workflow's nodes, once the workflow is given", async () => {
    const seeded = seedStore();
    expect(
      valuesOf(await offered(seeded, "run", "hello", "--node", "")),
    ).toEqual(["plan", "build"]);
    expect(valuesOf(await offered(seeded, "run", "--node", ""))).toEqual([]);
    expect(
      valuesOf(await offered(seeded, "context", "explain", "hello", "")),
    ).toEqual(["plan", "build"]);
  });

  it("offers open decisions by id, never their question", async () => {
    const seeded = seedStore();
    const lines = await offered(seeded, "decide", "--id", "");
    expect(lines).toEqual(["live1-1\tquestion of live1/build"]);
    expect(lines.join("\n")).not.toContain("never shows");
  });
});

describe("the store, for completion", () => {
  it("is only read: its file is unchanged", async () => {
    const seeded = seedStore();
    const before = readFileSync(seeded.storeFile);
    const { mtimeMs } = statSync(seeded.storeFile);
    await offered(seeded, "logs", "");
    await offered(seeded, "decide", "--id", "");
    expect(readFileSync(seeded.storeFile).equals(before)).toBe(true);
    expect(statSync(seeded.storeFile).mtimeMs).toBe(mtimeMs);
  });

  it("gives no values at another schema version, and the rest still", async () => {
    const seeded = seedStore();
    const db = new DatabaseSync(seeded.storeFile);
    db.exec("PRAGMA user_version = 999");
    db.close();
    expect(await offered(seeded, "logs", "")).toEqual([]);
    expect(valuesOf(await offered(seeded, "logs", "--j"))).toEqual(["--json"]);
  });

  it("is never created: ork __complete leaves a fresh home empty", () => {
    const home = tempDir("ork-complete-fresh-");
    const result = spawnComplete(home, seedStore().project, ["logs", ""]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(existsSync(path.join(home, ".ork"))).toBe(false);
  });

  it("answers through the program, a typed --help completed, not obeyed", () => {
    const seeded = seedStore();
    const result = spawnComplete(seeded.home, seeded.project, [
      "run",
      "--help",
      "--dr",
    ]);
    expect(result.stdout).toBe(
      ":group flags\n--driver\tsdk (API key or cloud provider) or cli (your claude login)\n",
    );
    expect(result.stderr).toBe("");
  });

  it("prints nothing when completing fails", async () => {
    const broken: CommandDef = {
      subCommands: () => Promise.reject(new Error("broken")),
    };
    expect(await printed(broken, [""])).toBe("");
  });

  it("stays quick on a store with 500 runs", async () => {
    const seeded = seedStore(500);
    await offered(seeded, "");
    const started = performance.now();
    const lines = await offered(seeded, "logs", "");
    // In process it takes tens of milliseconds; the wide margin only catches a
    // query that grows with the store, not a slow machine.
    expect(performance.now() - started).toBeLessThan(2000);
    expect(lines).toHaveLength(50);
  });
});
