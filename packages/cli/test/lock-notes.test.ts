/**
 * @file Tests for the note `ork run` prints for a `branch:` lock with no origin
 *   (RFC-016): one line per such lock naming the folder, none for a repo with
 *   an origin, and none for a lock that is not a `branch:` lock; and the call
 *   in `ork run`'s preflight that prints it.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "@krapht/ork-core";
import { parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { runWorkflowFile } from "../src/index.ts";
import { localLockNotes } from "../src/run/lock-notes.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";

const repo = (origin?: string): string => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-lock-note-")));
  execFileSync("git", ["init", "-q", dir]);
  if (origin !== undefined) {
    execFileSync("git", ["-C", dir, "remote", "add", "origin", origin]);
  }
  return dir;
};

const workflowOf = (...locks: string[]): Workflow => {
  const nodes = locks.map(
    (lock, i) =>
      `  n${String(i)}: { type: tool.shell, command: x, lock: '${lock}' }`,
  );
  const parsed = parseWorkflow(
    [
      "schemaVersion: 1",
      "name: t",
      "inputs:",
      "  branch: { type: string }",
      "nodes:",
      ...nodes,
    ].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

describe("localLockNotes", () => {
  it("names the lock and the folder when the repo has no origin", async () => {
    const dir = repo();
    const notes = await localLockNotes(
      workflowOf("branch:{{inputs.branch}}"),
      { branch: "main" },
      dir,
    );
    expect(notes).toEqual([
      `branch:main is local to ${dir}: no origin, so no other clone shares it`,
    ]);
  });

  it("says it once for a lock several nodes name", async () => {
    const notes = await localLockNotes(
      workflowOf("branch:main", "branch:main"),
      {},
      repo(),
    );
    expect(notes).toHaveLength(1);
  });

  it("is quiet when the repo has an origin", async () => {
    const notes = await localLockNotes(
      workflowOf("branch:main"),
      {},
      repo("https://example.com/org/repo.git"),
    );
    expect(notes).toEqual([]);
  });

  it("is quiet for a lock that is not a branch lock", async () => {
    const notes = await localLockNotes(workflowOf("deploy"), {}, repo());
    expect(notes).toEqual([]);
  });
});

/**
 * `ork run`'s stderr for a one-node workflow with a `branch:main` lock in
 * `dir`.
 */
const runErr = async (dir: string): Promise<string> => {
  writeFileSync(
    path.join(dir, "w.ork.yaml"),
    "schemaVersion: 1\nname: w\nnodes:\n  push: { type: tool.shell, command: x, lock: 'branch:main' }\n",
  );
  const err: string[] = [];
  await runWorkflowFile({
    file: "w.ork.yaml",
    cwd: dir,
    inputs: [],
    inPlace: true,
    json: false,
    runtime: () => Promise.reject(new Error("no session")),
    drivers: standInDrivers,
    driverChecks: openCodeReady,
    human: {
      ask: () => Promise.resolve("none"),
      permit: () => Promise.resolve({ allow: false, message: "no" }),
    },
    store: openStore(":memory:"),
    home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
    out: () => {
      // The transcript isn't what this checks.
    },
    err: line => {
      err.push(line);
    },
    tools: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    installed: () => true,
  });
  return err.join("\n");
};

describe("ork run's note for a local branch lock", () => {
  it("prints it at the start for a repo with no origin", async () => {
    const dir = repo();
    expect(await runErr(dir)).toContain(
      `branch:main is local to ${dir}: no origin, so no other clone shares it`,
    );
  });

  it("prints nothing for a repo with an origin", async () => {
    const err = await runErr(repo("https://example.com/org/repo.git"));
    expect(err).not.toContain("is local to");
  });
});
