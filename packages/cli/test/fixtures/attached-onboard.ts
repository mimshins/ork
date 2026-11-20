/**
 * @file The harness of tests that run `ork onboard`'s built-ins in an attached
 *   project (RFC-022 option D): a registered clone, the real bundles through
 *   `runWorkflowFile`, a scripted runtime that records the `ork/*` branches the
 *   repository has when each session starts, `finish` run in this process and
 *   `format` stubbed, and the gate answered with a given choice.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  type AgentRuntime,
  builtinWorkflowFile,
  type EventStore,
  type HumanChannel,
  openStore,
  type RunResult,
  type RunSettings,
} from "@krapht/ork-core";
import { spawnTool, type ToolRunner } from "@krapht/ork-nodes";

import { registerProject, runWorkflowFile } from "../../src/index.ts";
import { settleWrite } from "../../src/onboard/runs.ts";
import { finish, finishText } from "../../src/onboard/verbs-finish.ts";
import {
  openCodeReady,
  readyOnly,
  type Script,
  scriptedRuntime,
  standInDrivers,
} from "./drivers.ts";
import { SCRIPT, SUGGESTION } from "./onboard.ts";
import {
  checkoutNow,
  clone,
  commit,
  git,
  registered,
  tmp,
} from "./run-root-kit.ts";

/** Answers every gate with `choice` (the recommended one when it isn't one). */
export const answering =(choice: string): HumanChannel => ({
  ask: ({ options, recommended }) =>
    Promise.resolve(
      options.some(o => o.id === choice) ? choice : (recommended ?? ""),
    ),
  permit: () => Promise.resolve({ allow: true }),
});

/** The script a tool node runs (`sh -eu <file>`), or "" for another program. */
const scriptOf = (program: string, args: readonly string[]): string => {
  const file = program === "sh" ? (args.at(-1) ?? "") : "";
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};

export const outputOf = (result: RunResult | null, id: string) =>
  result?.nodes.find(n => n.id === id)?.output ?? {};

export const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** The settings run `runId` recorded when it started. */
export const settingsOf = (store: EventStore, runId: string): RunSettings =>
  store
    .events(runId)
    .map(({ event }) => event)
    .flatMap(event => (event.type === "run.started" ? [event.settings] : []))
    .at(0) ?? {};

export const WRITE_INPUTS = [
  `picks=${JSON.stringify([SUGGESTION])}`,
  "survey=a one-file app",
  "answers=Q: slow tests\nA: weekly",
];

/** Every branch the repository at `root` has, by name. */
export const branchesOf = (root: string): string =>
  git(root, "branch", "--format=%(refname:short)");

/** `inner`, recording `root`'s branches as each session starts. */
const watching = (
  inner: AgentRuntime,
  root: string,
  branches: string[],
): AgentRuntime => ({
  ...inner,
  start: (...args) => {
    branches.push(branchesOf(root));
    return inner.start(...args);
  },
});

/** The tool runner: `format` stubbed, `finish` in this process. */
const toolsOf = (cwds: string[]): ToolRunner => {
  const checks = readyOnly("open-code");
  return async (program, args, options) => {
    cwds.push(options.cwd);
    const script = scriptOf(program, args);
    // Only the writer's prompt reads it; these tests need none of its text.
    if (script.includes("__onboard format")) {
      return { exitCode: 0, stdout: "the fields", stderr: "" };
    }
    if (script.includes("__onboard finish")) {
      const env = options.env ?? {};
      const report = await finish({
        root: options.cwd,
        worktree: env["WORKTREE"] ?? "",
        branch: env["BRANCH"] ?? "",
        // `--base "$SEED"`, which the script passes only when it is set.
        base: env["SEED"] === "" ? undefined : env["SEED"],
        run: env["ORK_RUN"],
        checks,
      });
      return {
        exitCode: report.problems.length > 0 ? 1 : 0,
        stdout: finishText(report),
        stderr: "",
      };
    }
    return spawnTool(program, args, options);
  };
};

type RunOptions = Parameters<typeof runWorkflowFile>[0];

/** The project's folder in the clone at `root`: `sub`, committed, or the root. */
const projectIn = (root: string, sub: string): string => {
  if (sub === "") return root;
  mkdirSync(path.join(root, sub));
  writeFileSync(path.join(root, sub, "README.md"), "The app.\n");
  git(root, "add", "-A");
  commit(root, "add the project's folder");
  return path.join(root, sub);
};

/**
 * Attaches the project at `project`: with `ork register` at the clone's root,
 * or (a folder in the clone, which `ork register` records as the clone) by
 * recording it in the store, as a project with a prefix in its repository.
 */
const attach = (store: EventStore, project: string, home: string) => {
  if (existsSync(path.join(project, ".git"))) {
    return registered(registerProject(store, project, { home }));
  }
  const id = path.basename(project);
  const dir = path.join(home, ".ork", "projects", id);
  mkdirSync(path.join(dir, "workflows"), { recursive: true });
  return store.addProject({ id, root: project, mode: "attached", dir });
};

/**
 * An attached project (in `sub` of the clone when given), the two bundles, and
 * a way to run either with `script` playing the agents.
 */
export const setUp = ({
  script = SCRIPT,
  sub = "",
}: { script?: Script; sub?: string } = {}) => {
  const root = clone(false);
  const home = tmp("ork-home-");
  const store: EventStore = openStore(":memory:");
  const project = projectIn(root, sub);
  const place = attach(store, project, home);
  const before = checkoutNow(root);
  const branchesAtStart = branchesOf(root);
  const { runtime, specs } = scriptedRuntime("open-code", script);
  const cwds: string[] = [];
  const branches: string[] = [];
  const errors: string[] = [];
  const run = (
    name: string,
    inputs: string[],
    more: Partial<RunOptions> = {},
  ) =>
    runWorkflowFile({
      file: builtinWorkflowFile(place, name) ?? "",
      cwd: root,
      inputs,
      untrusted: inputs.map(pair => pair.slice(0, pair.indexOf("="))),
      inPlace: false,
      json: true,
      driver: "open-code",
      runtime: () => Promise.resolve(watching(runtime, root, branches)),
      driverChecks: openCodeReady,
      drivers: standInDrivers,
      store,
      home,
      tools: toolsOf(cwds),
      human: answering("keep"),
      out: () => {},
      err: line => {
        errors.push(line);
      },
      ...more,
    });
  return {
    root,
    home,
    store,
    place,
    before,
    branchesAtStart,
    specs,
    cwds,
    branches,
    errors,
    run,
  };
};

type Setup = ReturnType<typeof setUp>;

/** What `ork onboard` says, and its exit code, once the write run ended. */
export const settled = (s: Setup, result: RunResult) =>
  settleWrite(
    {
      store: s.store,
      place: s.place,
      driver: "open-code",
      runtime: () => Promise.reject(new Error("unused")),
      out: () => {},
      err: () => {},
    },
    result,
    [],
    false,
  );
