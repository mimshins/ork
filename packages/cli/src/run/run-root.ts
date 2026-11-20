/**
 * @file A run's own working root for an attached project's built-in with
 *   companion files (RFC-021 Option C): `ork run` opens a worktree of the
 *   project's commit beside the clone, writes the bundle into it, and runs
 *   every node there, so read-only agents read the bundle inside their own
 *   folder and the user's checkout is never written to. A resume re-opens it at
 *   the recorded commit, with the bundle the run started with (an upgraded
 *   Ork's has another hash); every end of the run closes it. In-repo projects
 *   and built-ins without companion files have none. A seeded run (RFC-022
 *   option D, ADR-114: `ork onboard` in an attached project) also seeds its
 *   worktrees with the project's workflows and rules from Ork's folder for it,
 *   and makes no commit on any branch (`commit: never` for its run root and
 *   node worktrees, whatever the rules say), so no `ork/…` branch appears in
 *   the repository; the folder is recorded in the run's settings, so a resume
 *   seeds and detaches the same way.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  applyProject,
  BUILTIN_PREFIX,
  type CompiledGraph,
  gitRulesOf,
  loadProject,
  openRunRoot,
  placeFiles,
  placeFor,
  type ProjectPlace,
  repoRoot,
  resolveBase,
  type RunEvent,
  type RunRoot,
  runRootEvent,
  startedBundleUnder,
  type WorktreeSeed,
} from "@krapht/ork-core";
import {
  parseWorkflow,
  type ResolvedGitRules,
  type Workflow,
} from "@krapht/ork-schema";

import type { RunWorkflowOptions } from "./workflow-options.ts";

const RULES = "project.yaml";
const WORKFLOWS = "workflows";
const WORKFLOW_SUFFIX = ".ork.yaml";

/** The folder the run seeds from: given, or recorded when it started. */
export const seedOf = (
  options: Pick<RunWorkflowOptions, "seed" | "resume">,
): string | undefined => options.seed ?? options.resume?.settings.seed;

/** `workflow` under `commit: never`: `merge: auto` needs commits, so `patch`. */
export const withoutCommits = (workflow: Workflow): Workflow => {
  const git = workflow.rules?.git ?? {};
  return {
    ...workflow,
    rules: {
      ...workflow.rules,
      git: {
        ...git,
        commit: "never",
        merge: git.merge === "never" ? "never" : "patch",
      },
    },
  };
};

/** The compiled graph of a run seeded from `folder` (as it is without one). */
export const seededGraph = (
  graph: CompiledGraph | null,
  folder: string | undefined,
): CompiledGraph | null =>
  graph === null || folder === undefined
    ? graph
    : { ...graph, workflow: withoutCommits(graph.workflow) };

/** The project's folder within its repository: `""` or `sub/`. */
export const prefixOf = (projectRoot: string): string =>
  execFileSync("git", ["rev-parse", "--show-prefix"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

/** What of `folder` is seeded: its `workflows/*.ork.yaml` and `project.yaml`. */
const seedPaths = (folder: string): string[] => {
  const workflows = path.join(folder, WORKFLOWS);
  const files = existsSync(workflows)
    ? readdirSync(workflows, { withFileTypes: true })
        // Links are passed on: the seed itself skips them.
        .filter(entry => !entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => name.endsWith(WORKFLOW_SUFFIX))
        .toSorted()
        .map(name => `${WORKFLOWS}/${name}`)
    : [];
  return [...files, ...(existsSync(path.join(folder, RULES)) ? [RULES] : [])];
};

/**
 * The seed of a run's worktrees from `folder`, into `<prefix>.ork` of the
 * project at `projectRoot`; none when the run seeds nothing.
 */
export const seedFor = (
  folder: string | undefined,
  projectRoot: string,
): { seed?: WorktreeSeed } =>
  folder === undefined
    ? {}
    : {
        seed: {
          from: folder,
          to: `${prefixOf(projectRoot)}.ork`,
          paths: seedPaths(folder),
        },
      };

/** The built-in a workflow file is, when it needs a run root. */
type Trigger = {
  place: ProjectPlace;
  arg: string;
  rules: ResolvedGitRules;
  /** The bundle folder the file is in, written when the run started. */
  folder: string;
};

/**
 * The attached project's built-in with companion files that `options.file` is
 * (its bundle folder holds more than the workflow); `undefined` otherwise.
 */
const triggerOf = (options: RunWorkflowOptions): Trigger | undefined => {
  const absolute = path.resolve(options.cwd, options.file);
  const folder = path.dirname(absolute);
  const place = placeFor(folder, options.store.projects());
  if (
    place.mode !== "attached" ||
    path.dirname(folder) !== path.join(placeFiles(place).runs, ".builtin") ||
    // A missing file has no root: the load reports it, as for any workflow.
    !existsSync(absolute) ||
    readdirSync(folder).length < 2
  ) {
    return undefined;
  }
  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch {
    // Unreadable (permissions, a folder): the load reports it.
    return undefined;
  }
  const parsed = parseWorkflow(text);
  // An unparseable file has no root: its check says why, as for any workflow.
  if (!parsed.ok) return undefined;
  const { project } = loadProject(place.root, placeFiles(place).rules);
  const applied = applyProject(
    parsed.workflow,
    project === undefined ? {} : { project },
  );
  // A seeded run's root is detached too: no `ork/…` branch, even for a while.
  const effective =
    seedOf(options) === undefined ? applied : withoutCommits(applied);
  const arg = `${BUILTIN_PREFIX}${path.basename(absolute, ".ork.yaml")}`;
  return { place, arg, rules: gitRulesOf(effective), folder };
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Opens the run root of `trigger`, with the bundle written in. */
const openFor = async (
  options: RunWorkflowOptions,
  runId: string,
  { place, arg, rules, folder }: Trigger,
): Promise<RunRoot> => {
  if ((await repoRoot(place.root)) === null) {
    throw new Error(
      `${place.root} is not a git repository: ${arg} runs in a worktree of its commit`,
    );
  }
  const root = await openRunRoot({
    // The repository's top, so a project in a subfolder gets its run root (and
    // the run's worktrees) beside the clone, not inside its working tree.
    root: path.join(place.root, path.relative(prefixOf(place.root), ".")),
    runId,
    rules,
    // shortcut: `git.base` and the names see no inputs; render them once a
    // built-in with a run root takes inputs they need.
    base:
      options.baseRef ??
      options.resume?.settings.baseRef ??
      (await resolveBase(place.root, rules, {})),
    known: options.resume !== undefined,
  });
  // The bundle the workflow file is in, so a resume goes on with the files it
  // started with: an upgraded Ork's own bundle has another hash.
  const written = startedBundleUnder(root.path, folder);
  if (!written.ok) {
    await root.close();
    throw new Error(written.error);
  }
  return root;
};

/**
 * The run's own root when the workflow needs one, opened (or adopted) with its
 * bundle written in; `root` is absent when it needs none, and `error` names the
 * cause when it could not be opened (nothing is left behind then).
 */
export const openRunRootFor = async (
  options: RunWorkflowOptions,
  runId: string,
): Promise<{ ok: true; root?: RunRoot } | { ok: false; error: string }> => {
  const trigger = triggerOf(options);
  if (trigger === undefined) return { ok: true };
  try {
    return { ok: true, root: await openFor(options, runId, trigger) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
};

/**
 * Closes the run root and records its removal on `emit`; when its folder stays,
 * says so on `err` instead (`ork worktrees` lists it by the run). A second
 * close is no error, so every end path may call it.
 */
export const closeRunRoot = async (
  root: RunRoot | undefined,
  err: (line: string) => void,
  emit?: (event: RunEvent) => void,
): Promise<void> => {
  if (root === undefined) return;
  try {
    await root.close();
  } catch (error) {
    err(`${messageOf(error)}; \`ork worktrees clean\` removes it`);
    return;
  }
  emit?.(runRootEvent(root, "removed"));
};
