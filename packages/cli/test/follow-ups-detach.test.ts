/**
 * @file Tests for `ork run --detach --follow-ups`: a value that can't be taken
 *   is refused before a run folder is made, so no run is left behind.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const WITH_BRIEF = [
  "schemaVersion: 1",
  "name: take",
  "inputs:",
  "  brief:",
  "    type: string",
  "    required: true",
  "nodes:",
  "  write:",
  "    type: agent.worker",
  "    isolation: shared",
  '    prompt: "Do: {{inputs.brief}}"',
  "",
].join("\n");

/** `ork run take.ork.yaml --detach …` for real, in a project with no follow-ups. */
const detached = (...args: string[]) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-fur-det-")));
  mkdirSync(path.join(dir, ".ork"));
  writeFileSync(path.join(dir, "take.ork.yaml"), WITH_BRIEF);
  const result = spawnSync(
    process.execPath,
    [BIN, "run", "take.ork.yaml", "--detach", ...args],
    {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: dir,
        ORK_NO_UPDATE_CHECK: "1",
      },
    },
  );
  return { result, dir };
};

describe("ork run --detach with a --follow-ups that can't be taken", () => {
  it.each([
    [["--follow-ups", "zzzz"], "No follow-up `zzzz`"],
    [["--follow-ups", "due"], "no agent follow-ups are due"],
  ])("refuses %j before a run folder is made", (args, why) => {
    const { result, dir } = detached(...args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(why);
    expect(`${result.stdout}${result.stderr}`).not.toContain("(output:");
    expect(existsSync(path.join(dir, ".ork", "runs"))).toBe(false);
  });
});
