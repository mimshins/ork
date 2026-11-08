/**
 * @file A project and a store for the tab-completion tests: a folder that is a
 *   project (a `.git` marker and one workflow, `hello`, of nodes `plan` and
 *   `build`), and a store in a temporary home with its runs, a live one with
 *   an open decision, and another project's run.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, storePath } from "@krapht/ork-core";

export type Seeded = { home: string; project: string; storeFile: string };

const WORKFLOW = [
  "schemaVersion: 1",
  "name: hello",
  "nodes:",
  "  plan:",
  "    type: tool.shell",
  '    command: "echo plan"',
  "  build:",
  "    type: tool.shell",
  '    command: "echo build"',
  "",
].join("\n");

/** A temporary folder, its real path (macOS's /var is a link). */
export const tempDir = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

/** A project folder with the `hello` workflow. */
export const seedProject = (): string => {
  const project = tempDir("ork-complete-project-");
  mkdirSync(path.join(project, ".git"));
  mkdirSync(path.join(project, ".ork", "workflows"), { recursive: true });
  writeFileSync(
    path.join(project, ".ork", "workflows", "hello.ork.yaml"),
    WORKFLOW,
  );
  return project;
};

/**
 * A project and a home whose store has `extra` old runs of the project, then
 * `done1` (finished) and `live1` (running in this process, with the open
 * decision `live1-1` of node `build`), and `other1` of another project.
 */
export const seedStore = (extra = 0): Seeded => {
  const project = seedProject();
  const home = tempDir("ork-complete-home-");
  const storeFile = storePath(home);
  const store = openStore(storeFile);
  const begin = (id: string, root: string): void => {
    store.begin({ id, workflow: "hello", file: "hello.ork.yaml", project: root });
  };
  for (let n = 0; n < extra; n += 1) begin(`old${String(n)}`, project);
  begin("done1", project);
  store.append("done1", {
    type: "run.finished",
    result: {
      runId: "done1",
      status: "succeeded",
      costUsd: 0,
      nodes: [],
      reasons: [],
      worktrees: [],
    },
  });
  begin("live1", project);
  for (const id of ["plan", "build"]) {
    store.append("live1", {
      type: "node.started",
      id,
      nodeType: "tool.shell",
      round: 1,
    });
  }
  store.openDecision({
    id: "live1-1",
    runId: "live1",
    node: "build",
    kind: "question",
    question: "A question completion never shows",
    options: [{ id: "yes" }, { id: "no" }],
  });
  begin("other1", "/somewhere/else");
  store.close();
  return { home, project, storeFile };
};
