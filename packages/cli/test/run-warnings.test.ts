/**
 * @file The real `ork run` and what the checks say before it starts (RFC-009):
 *   a warning prints and the run goes ahead, and a condition on a value its
 *   source can't have stops the run before anything happens.
 */

import { execFileSync, spawnSync } from "node:child_process";
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

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const LOOPING = `schemaVersion: 1
name: looping
nodes:
  a: { type: tool.shell, command: "true" }
  b: { type: tool.shell, command: "true" }
edges:
  - { from: a, to: b, when: "false" }
`;

const MISTYPED = `schemaVersion: 1
name: mistyped
nodes:
  ask: { type: human.gate, question: Go?, options: [approve, stop], default: approve, timeout: 1s }
  done: { type: tool.shell, command: "touch ran" }
edges:
  - { from: ask, to: done, when: "choice == 'aprove'" }
`;

describe("ork run and the checks", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const run = (text: string) => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-warn-")));
    dirs.push(root);
    const home = path.join(root, "home");
    const repo = path.join(root, "repo");
    mkdirSync(home);
    mkdirSync(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    writeFileSync(path.join(repo, "w.ork.yaml"), text);
    const done = spawnSync(process.execPath, [BIN, "run", "w.ork.yaml"], {
      cwd: repo,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: home,
        ORK_NO_UPDATE_CHECK: "1",
      },
    });
    return { ...done, ran: existsSync(path.join(repo, "ran")) };
  };

  it("prints a warning and goes ahead", () => {
    const done = run(LOOPING);
    expect(done.stderr).toContain("(when.never)");
    expect(done.status).toBe(0);
  });

  it("stops on a value the source can't have, before anything runs", () => {
    const done = run(MISTYPED);
    expect(done.stderr).toContain("(when.value)");
    expect(done.status).toBe(1);
    expect(done.ran).toBe(false);
  });
});
