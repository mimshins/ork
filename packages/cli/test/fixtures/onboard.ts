/**
 * @file The harness of `ork onboard`'s end-to-end tests: a real git repository,
 *   `runOnboard` with scripted answers and a scripted driver, and the real
 *   `ork __onboard` verbs behind the tool nodes (through `ORK_BIN`), or in this
 *   process when a case sets `inProcess`.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  type HumanChannel,
  openStore,
} from "@krapht/ork-core";
import type { DriverId } from "@krapht/ork-integrations";
import { spawnTool } from "@krapht/ork-nodes";
import { parseWorkflow, serializeWorkflow } from "@krapht/ork-schema";

import { runOnboard } from "../../src/onboard/flow.ts";
import { finish, finishText } from "../../src/onboard/verbs-finish.ts";
import type { DriverChecks } from "../../src/run/ready-driver.ts";
import { formatBrief } from "../../src/onboard/verbs-format.ts";
import {
  pathWithoutDrivers,
  readyOnly,
  type Script,
  scriptedRuntime,
  standInDrivers,
} from "./drivers.ts";

const BIN = path.resolve(import.meta.dirname, "../../src/bin.ts");

export const WORKFLOW_FILE = ".ork/workflows/check-on-change.ork.yaml";

/** Valid, with its keys out of the serializer's order, so `finish` rewrites it. */
export const WRITTEN = `nodes:
  build:
    type: agent.worker
    agent: ork-implementer
    prompt: Make the change.
limits:
  budgetUsd: 2
  budgetTokens: 400000
name: check-on-change
schemaVersion: 1
`;

/** Without the caps every written workflow must carry. */
export const UNCAPPED = WRITTEN.replace(/limits:\n {2}budget.*\n {2}budget.*\n/u, "");

export const SUGGESTION = {
  workflow: "check-on-change",
  why: "Reviews wait on a check nobody runs before opening a PR.",
  decidedBy: "the reviewer approves the change",
  caps: { budgetUsd: 2, budgetTokens: 400000 },
  evidence: [{ path: "AGENTS.md", note: "names the review rule" }],
  feedback: ["fb-1234"],
};

/**
 * Not `codex`: onboarding's built-ins set `maxTurns`, which it can't hold, so
 * `ork run` refuses them under the real descriptor (L454).
 */
export const DRIVERS = ["claude-code", "open-code", "command-code"] as const;

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A repository with one commit and no `.ork/`, in its own folder. */
export const repository =(): string => {
  const dir = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "ork-onboard-e2e-"))),
    "app",
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "AGENTS.md"), "# App\nRun the checks.\n");
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "app", scripts: { test: "node --test" } }),
  );
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.email", "dev@example.com"],
    ["config", "user.name", "Dev"],
    ["add", "-A"],
    ["commit", "-q", "-m", "init"],
  ]) {
    git(dir, ...args);
  }
  return dir;
};

/**
 * A repository whose committed `.gitignore` lists the local agent files a
 * Claude Code user keeps, with those files present (and so copied into every
 * worktree Ork makes).
 */
export const repositoryWithLocalFiles = (): string => {
  const dir = repository();
  writeFileSync(
    path.join(dir, ".gitignore"),
    "CLAUDE.local.md\n.claude/settings.local.json\n",
  );
  git(dir, "add", ".gitignore");
  git(dir, "commit", "-q", "-m", "ignore local files");
  writeFileSync(path.join(dir, "CLAUDE.local.md"), "my notes\n");
  mkdirSync(path.join(dir, ".claude"));
  writeFileSync(path.join(dir, ".claude/settings.local.json"), "{}\n");
  return dir;
};

/**
 * A file that runs the `ork` of these sources, for the tool nodes' `ORK_BIN`;
 * `missing` names a verb it cannot find, as a shell says it (exit 127).
 */
const orkWrapper = (missing?: string): string => {
  const file = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "ork-bin-"))),
    "ork",
  );
  const lost =
    missing === undefined
      ? ""
      : `[ "\$2" = "${missing}" ] && { echo "ork: command not found" >&2; exit 127; }\n`;
  // The tool node's env is scrubbed, so the cache `compile-cache.ts` gives other children is set here.
  const cache = process.env["ORK_TEST_COMPILE_CACHE"];
  const cacheEnv = cache === undefined ? "" : `NODE_COMPILE_CACHE="${cache}" `;
  writeFileSync(
    file,
    `#!/bin/sh\n${lost}${cacheEnv}PATH="${pathWithoutDrivers("$PATH")}" ORK_NO_UPDATE_CHECK=1 exec "${process.execPath}" "${BIN}" "$@"\n`,
  );
  chmodSync(file, 0o755);
  return file;
};

const scriptOf = (file: string | undefined): string => {
  try {
    return file === undefined ? "" : readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

/** An `__onboard` verb the tool nodes run. */
export type Verb = "format" | "finish";

/** The verb a tool node's script runs, or null when it runs something else. */
const verbOf = (program: string, args: readonly string[]): Verb | null => {
  // `sh -eu <file>`: the node writes its script to a file and passes the path last.
  const script = program === "sh" ? scriptOf(args.at(-1)) : "";
  if (script.includes("__onboard format")) return "format";
  if (script.includes("__onboard finish")) return "finish";
  // A renamed verb must fail here, not fall back to the slow real CLI unseen.
  if (script.includes("__onboard")) throw new Error(`unknown __onboard verb in: ${script}`);
  return null;
};

/** `verb` run in this process, as the real `ork __onboard <verb>` would. */
const runVerb = async (
  verb: Verb,
  { cwd, env = {} }: { cwd: string; env?: Readonly<Record<string, string>> },
  checks: DriverChecks,
): Promise<Awaited<ReturnType<typeof spawnTool>>> => {
  if (verb === "format") {
    const brief = formatBrief();
    return {
      exitCode: brief.ok ? 0 : 2,
      stdout: brief.ok ? brief.text : "",
      stderr: brief.ok ? "" : `ork __onboard: ${brief.error}\n`,
    };
  }
  const report = await finish({
    root: cwd,
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
};

/**
 * The tool nodes' runner: the real `ork` behind `ORK_BIN`, except for the verbs
 * the case runs in this process (no CLI start, and the stand-in driver checks
 * in place of the machine's). Any other program goes to `spawnTool`.
 */
const toolsOf = (c: Case): typeof spawnTool => {
  const inProcess = c.inProcess ?? [];
  const bin = orkWrapper(c.missing);
  const checks = readyOnly(c.driver);
  return (program, args, options) => {
    const verb = verbOf(program, args);
    return verb !== null && inProcess.includes(verb)
      ? runVerb(verb, options, checks)
      : spawnTool(program, args, {
          ...options,
          env: { ...options.env, ORK_BIN: bin },
        });
  };
};

/**
 * Every file of `.ork/` except the runs', by path, with its text; none when
 * there is no `.ork/` (an attached project's files are in Ork's folder).
 */
export const orkFiles = (root: string, dir = ".ork"): Record<string, string> => {
  const found: Record<string, string> = {};
  const here = path.join(root, dir);
  if (!existsSync(here)) return found;
  for (const entry of readdirSync(here, { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.name === "runs") continue;
    Object.assign(
      found,
      entry.isDirectory()
        ? orkFiles(root, relative)
        : { [relative]: readFileSync(path.join(root, relative), "utf8") },
    );
  }
  return found;
};

/** What the working tree holds of Ork's files, and what git says changed. */
export const treeOf = (root: string): string =>
  JSON.stringify([orkFiles(root), git(root, "status", "--porcelain")]);

export type Flow = {
  code: number;
  out: string;
  err: string;
  store: EventStore;
  root: string;
  specs: ReturnType<typeof scriptedRuntime>["specs"];
  /** The gate's question as the person saw it. */
  gate: string[];
  /** The working tree when "Start?" was answered, and when the gate asked. */
  trees: { start: string[]; gate: string[] };
};

export type Case = {
  driver: DriverId;
  script: Script;
  /** Answers to the three questions, "Start?" and the pick. */
  answers?: string[];
  /** What the gate is answered with. */
  gate?: "keep" | "discard";
  root?: string;
  store?: EventStore;
  review?: boolean;
  /** `--fresh`. */
  fresh?: boolean;
  /** A `__onboard` verb the tool nodes' `ORK_BIN` cannot run: exit 127. */
  missing?: string;
  /**
   * Run the `__onboard` verbs in this process, not through the real `ork`
   * (`ORK_BIN`); the wiring stays covered by the cases that do not set it.
   */
  inProcess?: readonly Verb[];
};

const ANSWERS = ["slow tests", "weekly", "a PR", "y", "1"];
export const SCRIPT: Script = {
  suggestions: [SUGGESTION],
  rounds: [{ [WORKFLOW_FILE]: WRITTEN }],
};

/**
 * Runs `ork onboard` with scripted answers, a scripted driver and a real
 * repository.
 */
export const onboard = async (c: Case): Promise<Flow> => {
  const root = c.root ?? repository();
  const store = c.store ?? openStore(":memory:");
  const { runtime, specs } = scriptedRuntime(c.driver, c.script);
  const queue = [...(c.answers ?? ANSWERS)];
  const seen: Flow = {
    code: -1,
    out: "",
    err: "",
    store,
    root,
    specs,
    gate: [],
    trees: { start: [], gate: [] },
  };
  const human: HumanChannel = {
    ask: ({ question, options, recommended }) => {
      const choice = c.gate ?? "keep";
      seen.gate.push(question);
      seen.trees.gate.push(treeOf(root));
      return Promise.resolve(
        options.some(o => o.id === choice) ? choice : (recommended ?? ""),
      );
    },
    permit: () => Promise.resolve({ allow: false, message: "no" }),
  };
  const checks = readyOnly(c.driver);
  seen.code = await runOnboard({
    cwd: root,
    store,
    io: {
      input: process.stdin,
      output: process.stderr,
      env: { NO_COLOR: "1" },
      readLine: prompt => {
        if (prompt.includes("Start")) seen.trees.start.push(treeOf(root));
        return Promise.resolve(queue.shift());
      },
    },
    interactive: true,
    exec: () => Promise.resolve({ ok: true, stdout: "git version 2.40" }),
    nodeVersion: "24.20.0",
    review: c.review ?? false,
    fresh: c.fresh ?? false,
    checks,
    driverChecks: checks,
    drivers: standInDrivers,
    runtime: () => Promise.resolve(runtime),
    human,
    home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
    tools: toolsOf(c),
    installed: () => true,
    out: line => {
      seen.out += `${line}\n`;
    },
    err: line => {
      seen.err += `${line}\n`;
    },
  });
  return seen;
};

export const branches = (root: string): string[] =>
  git(root, "branch", "--list", "ork/*")
    .split("\n")
    .map(line => line.replace(/^[*+]?\s+/u, ""))
    .filter(line => line !== "");

/** The kept branch, by its one name. */
export const keptBranch = (root: string): string => {
  const [branch, ...more] = branches(root);
  if (branch === undefined || more.length > 0) {
    throw new Error(`Expected one ork branch, found ${branches(root).join()}.`);
  }
  return branch;
};

/** A workflow's text in the canonical form. */
export const canonical = (text: string): string => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error("The text is not a workflow.");
  return serializeWorkflow(parsed.workflow);
};

/** The id of the run of `workflow` the store holds; a mark when there is none. */
export const runIdOf = (store: EventStore, workflow: string): string =>
  // `store.runs()` lists the newest run first, so this is the latest one.
  store.runs().find(run => run.workflow === workflow)?.id ?? "no such run";

/** What a built-in's run recorded when it started: its inputs and which were untrusted. */
export const startedOf = (
  store: EventStore,
  workflow: string,
): { untrusted: string[]; inputs: Record<string, unknown> } => {
  const started = store
    .events(runIdOf(store, workflow))
    .map(({ event }) => event)
    .find(event => event.type === "run.started");
  return {
    untrusted:
      started?.type === "run.started"
        ? (started.settings?.untrusted ?? [])
        : [],
    inputs: started?.type === "run.started" ? { ...started.inputs } : {},
  };
};
