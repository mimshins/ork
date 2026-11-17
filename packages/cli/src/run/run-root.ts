/**
 * @file A run's own working root for an attached project's built-in with
 *   companion files (RFC-021 Option C): `ork run` opens a worktree of the
 *   project's commit beside the clone, writes the bundle into it, and runs
 *   every node there, so read-only agents read the bundle inside their own
 *   folder and the user's checkout is never written to. A resume re-opens it at
 *   the recorded commit; every end of the run closes it. In-repo projects and
 *   built-ins without companion files have none.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  applyProject,
  BUILTIN_PREFIX,
  builtinBundleUnder,
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
} from "@krapht/ork-core";
import { parseWorkflow, type ResolvedGitRules } from "@krapht/ork-schema";

import type { RunWorkflowOptions } from "./workflow-options.ts";

/** The built-in a workflow file is, when it needs a run root. */
type Trigger = { place: ProjectPlace; arg: string; rules: ResolvedGitRules };

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
  const effective = applyProject(
    parsed.workflow,
    project === undefined ? {} : { project },
  );
  const arg = `${BUILTIN_PREFIX}${path.basename(absolute, ".ork.yaml")}`;
  return { place, arg, rules: gitRulesOf(effective) };
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Opens the run root of `trigger`, with the bundle written in. */
const openFor = async (
  options: RunWorkflowOptions,
  runId: string,
  { place, arg, rules }: Trigger,
): Promise<RunRoot> => {
  if ((await repoRoot(place.root)) === null) {
    throw new Error(
      `${place.root} is not a git repository: ${arg} runs in a worktree of its commit`,
    );
  }
  const root = await openRunRoot({
    root: place.root,
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
  const written = builtinBundleUnder(root.path, arg);
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
