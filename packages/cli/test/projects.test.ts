/**
 * @file Tests for registered projects (ADR-035): `ork register` attaches a
 *   repository without writing into it, `ork init` records an in-repo one, and
 *   an attached project's workflow validates and runs from its own folder.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, placeFiles } from "@krapht/ork-core";
import type { ToolRunner } from "@krapht/ork-nodes";
import { describe, expect, it } from "vitest";

import {
  loadWorkflow,
  recordInRepo,
  registerProject,
  resolveWorkflowArg,
  runWorkflowFile,
} from "../src/index.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

const tmp = (prefix: string) =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

/** A clone with one commit and a doc a workflow can read. */
const clone = () => {
  const root = path.join(tmp("ork-attach-"), "app");
  mkdirSync(path.join(root, "docs"), { recursive: true });
  writeFileSync(path.join(root, "docs", "process.md"), "Ask before merging.\n");
  git(root, "init", "--quiet");
  git(root, "-c", "user.name=T", "-c", "user.email=t@example.com", "add", "-A");
  git(
    root,
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "base",
  );
  return root;
};

const WORKFLOW = `schemaVersion: 1
name: hello
layers:
  context: [../../docs/process.md]
nodes:
  greet:
    type: tool.shell
    command: echo hi
`;

/** The id of the store's one run; throws when there is none. */
const onlyRun = (store: { runs: () => { id: string }[] }): string => {
  const [run] = store.runs();
  if (run === undefined) throw new Error("no run was recorded");
  return run.id;
};

/** Throws when registering failed, so a test body needs no conditional. */
const registered = (result: ReturnType<typeof registerProject>) => {
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe("ork register", () => {
  it("attaches a repository from outside it and writes nothing into it", () => {
    const root = clone();
    const home = tmp("ork-home-");
    const store = openStore(":memory:");
    const first = registered(
      registerProject(store, path.join(root, "docs"), { home }),
    );
    expect(first.project).toMatchObject({
      id: "app",
      root,
      mode: "attached",
      dir: path.join(home, ".ork", "projects", "app"),
    });
    expect(existsSync(placeFiles(first.project).workflows)).toBe(true);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(existsSync(path.join(root, ".ork"))).toBe(false);

    const again = registered(registerProject(store, root, { home }));
    expect(again.created).toBe(false);
    expect(recordInRepo(store, root)).toMatchObject({ ok: false });
  });

  it("refuses an in-repo project, a taken id, and a folder outside git", () => {
    const store = openStore(":memory:");
    const home = tmp("ork-home-");
    const inRepo = clone();
    mkdirSync(path.join(inRepo, ".ork", "workflows"), { recursive: true });
    expect(registerProject(store, inRepo, { home })).toMatchObject({
      ok: false,
    });
    expect(registerProject(store, tmp("ork-none-"), { home })).toMatchObject({
      ok: false,
    });
    registered(registerProject(store, clone(), { home, id: "api" }));
    expect(registerProject(store, clone(), { home, id: "api" })).toMatchObject({
      ok: false,
      error: "a project is already registered as api",
    });
  });

  it("lets ork init record an in-repo project once", () => {
    const store = openStore(":memory:");
    const root = clone();
    expect(recordInRepo(store, root)).toMatchObject({
      ok: true,
      created: true,
      project: { mode: "in-repo", dir: path.join(root, ".ork") },
    });
    expect(recordInRepo(store, root)).toMatchObject({
      ok: true,
      created: false,
    });
  });
});

describe("an attached project's workflows", () => {
  it("validate with the repository's files and run in it, recording in the project's folder", async () => {
    const root = clone();
    const home = tmp("ork-home-");
    const store = openStore(":memory:");
    const { project } = registered(registerProject(store, root, { home }));
    const files = placeFiles(project);
    writeFileSync(path.join(files.workflows, "hello.ork.yaml"), WORKFLOW);
    writeFileSync(files.rules, "schemaVersion: 1\ngit: { commit: never }\n");

    const file = resolveWorkflowArg("hello", root, files.workflows);
    expect(file).toBe(path.join(files.workflows, "hello.ork.yaml"));
    const loaded = loadWorkflow(file, root, home, store.projects());
    expect(loaded.report.diagnostics).toEqual([]);
    expect(loaded.workflow?.rules?.git?.commit).toBe("never");

    const ran: string[] = [];
    const tools: ToolRunner = (_program, _args, { cwd }) => {
      ran.push(cwd);
      return Promise.resolve({ exitCode: 0, stdout: "hi\n", stderr: "" });
    };
    const result = await runWorkflowFile({
      file,
      cwd: home,
      inputs: [],
      inPlace: false,
      json: true,
      runtime: () => Promise.reject(new Error("no Claude here")),
      store,
      home,
      tools,
      out: () => {},
      err: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(ran).toEqual([root]);
    const [run] = store.runs();
    expect(run).toMatchObject({ project: root });
    expect(
      existsSync(path.join(files.runs, onlyRun(store), "events.jsonl")),
    ).toBe(true);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(existsSync(path.join(root, ".ork"))).toBe(false);
  });
});
