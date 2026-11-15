/**
 * @file Tests that `ork` ends cleanly where it used to print a stack trace: a
 *   reader closing its stdout early (`| head -1`) ends it quietly, with exit 0,
 *   on a run long enough that the write after `head` left fails; and a store
 *   that is not a database is one line, with exit 1.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

/** A bare environment with `home` as HOME and no update check. */
const envOf = (home: string): Record<string, string> => ({
  PATH: process.env["PATH"] ?? "",
  HOME: home,
  ORK_NO_UPDATE_CHECK: "1",
});

/** A HOME whose store holds run `r1` with `count` events, in project `dir`. */
const longRun = (count: number): string => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-epipe-")));
  mkdirSync(path.join(dir, ".ork"));
  const store = openStore(path.join(dir, ".ork", "state.db"));
  store.begin({
    id: "r1",
    workflow: "w",
    file: `${dir}/w.ork.yaml`,
    project: dir,
  });
  for (let i = 0; i < count; i += 1) {
    store.append("r1", {
      type: "node.started",
      id: "n",
      nodeType: "tool.shell",
      round: i + 1,
    });
  }
  store.close();
  return dir;
};

describe("a reader that closes stdout early", () => {
  it("ends ork quietly, with exit 0", () => {
    const dir = longRun(3000);
    const done = spawnSync(
      "bash",
      ["-o", "pipefail", "-c", `node "${BIN}" logs r1 --json | head -1`],
      {
        cwd: dir,
        encoding: "utf8",
        env: envOf(dir),
      },
    );
    expect(done.stdout.split("\n").filter(line => line !== "")).toHaveLength(1);
    expect(done.stderr).not.toContain("EPIPE");
    expect(done.status).toBe(0);
  });
});

describe("a store that is not a database", () => {
  it("is one line, with exit 1", () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-badstore-")));
    mkdirSync(path.join(dir, ".ork"));
    writeFileSync(path.join(dir, ".ork", "state.db"), "garbage");
    const done = spawnSync(process.execPath, [BIN, "ps"], {
      cwd: dir,
      encoding: "utf8",
      env: envOf(dir),
    });
    expect(done.stderr.trim().split("\n")).toEqual([
      `Can't open Ork's store at ${path.join(dir, ".ork", "state.db")}: file is not a database. Move the file aside, and Ork starts a new one.`,
    ]);
    expect(done.status).toBe(1);
  });
});
