/**
 * @file `ork __onboard finish --worktree <path> --branch <branch>`: checks what
 *   the onboarding writer left in its worktree, in the project root. Scope
 *   (only `.ork/workflows/*.ork.yaml` and `.ork/project.yaml`), caps, no new
 *   `driver`, `model` or agent beyond Ork's (one the file had at `HEAD`
 *   passes), canonical form (committed in the worktree, unless the writer has
 *   no branch under `commit: never`), validation under every ready driver, then
 *   the list of what a person should look at. It reads the worktree through the
 *   plain-file guards and runs nothing the model drafted
 *   (specs/cli/onboard-verbs.md#finish).
 */

import path from "node:path";

import { writePlainFile } from "@krapht/ork-core";
import {
  parseProject,
  parseWorkflow,
  serializeWorkflow,
  type Workflow,
} from "@krapht/ork-schema";

import { loadWorkflow, walkLoaded } from "../commands/validate.ts";
import { driverDiagnostics } from "../run/driver-check.ts";
import { checksHere, type DriverChecks } from "../run/ready-driver.ts";
import {
  collapseRemovedNodes,
  eyeOfProject,
  eyeOfWorkflow,
  newItems,
  removedItems,
  workflowProblems,
} from "./finish-checks.ts";
import {
  type Change,
  changesOf,
  commitIn,
  isAllowedPath,
  projectPrefix,
  textAtHead,
} from "./finish-git.ts";
import {
  inWorktree,
  readInWorktree,
  type Scene as Place,
} from "./finish-tree.ts";

export type FinishOptions = {
  /** The project root `finish` runs in. */
  root: string;
  worktree: string;
  branch: string;
  /** The run, named in the canonical commit. */
  run?: string | undefined;
  /** The drivers' checks; tests pass their own. */
  checks?: DriverChecks | undefined;
};

export type FinishReport = { problems: string[]; eye: string[] };

const PROJECT_FILE = ".ork/project.yaml";

/** The options plus where the project sits in the repository. */
type Scene = FinishOptions & Place;

/** The scope check: what changed, the problems, and the files to read. */
const scopeOf = (
  options: Scene,
  problems: string[],
): { workflows: string[]; project: boolean } => {
  let changes: Change[];
  try {
    changes = changesOf(options.root, options.worktree, options.branch);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    problems.push(
      `cannot read the writer's changes: ${reason.split("\n")[0] ?? ""}`,
    );
    return { workflows: [], project: false };
  }
  const paths = new Set<string>();
  for (const { path: file, kind } of changes) {
    if (!isAllowedPath(file)) {
      problems.push(
        `${file}: outside .ork/workflows/*.ork.yaml and ${PROJECT_FILE}`,
      );
    } else if (kind === "deleted" || kind === "other") {
      problems.push(
        `${file}: ${kind === "deleted" ? "deleted" : "renamed or retyped"}`,
      );
    } else paths.add(file);
  }
  return {
    workflows: [...paths].filter(file => file !== PROJECT_FILE).toSorted(),
    project: paths.has(PROJECT_FILE),
  };
};

type Read = { file: string; workflow: Workflow };

/** The workflow at `HEAD` in `root`, or null when it was not there or broken. */
const atHead = (root: string, file: string): Workflow | null => {
  const old = textAtHead(root, file);
  const parsed = old === null ? null : parseWorkflow(old);
  return parsed?.ok === true ? parsed.workflow : null;
};

/**
 * The problems a written file has, less a `driver`, `model` or agent the file
 * already had at `HEAD`: an edit to an existing workflow keeps what it names.
 * Caps are always required.
 */
const newProblems = (now: string[], before: Workflow | null): string[] => {
  if (before === null) return now;
  const had = new Set(workflowProblems(before));
  return now.filter(
    message => message.startsWith("limits.") || !had.has(message),
  );
};

/** Reads and checks each workflow file: schema, caps, names. */
const readWorkflows = (
  options: Scene,
  files: readonly string[],
  problems: string[],
): Read[] => {
  const reads: Read[] = [];
  for (const file of files) {
    const read = readInWorktree(options, file);
    if ("error" in read) {
      problems.push(`${file}: ${read.error}`);
      continue;
    }
    const parsed = parseWorkflow(read.text);
    if (!parsed.ok) {
      for (const d of parsed.diagnostics) {
        problems.push(`${file}: ${d.code} ${d.message}`);
      }
      continue;
    }
    for (const message of newProblems(
      workflowProblems(parsed.workflow),
      atHead(options.root, file),
    )) {
      problems.push(`${file}: ${message}`);
    }
    reads.push({ file, workflow: parsed.workflow });
  }
  return reads;
};

/**
 * Rewrites each file through the serializer and commits what changed; with no
 * branch (`commit: never`) the rewrite stays uncommitted, like the writer's.
 */
const canonicalize = (
  options: Scene,
  reads: readonly Read[],
  problems: string[],
): void => {
  const changed: { file: string; text: string }[] = [];
  for (const { file, workflow } of reads) {
    const text = serializeWorkflow(workflow);
    const now = readInWorktree(options, file);
    if ("text" in now && now.text === text) continue;
    const absolute = inWorktree(options, file);
    const written = writePlainFile(options.worktree, absolute, text, file);
    if (written.ok) changed.push({ file, text });
    else problems.push(`${file}: ${written.error}`);
  }
  if (changed.length === 0 || options.branch === "") return;
  const run = options.run === undefined ? "" : ` (run ${options.run})`;
  const refused = commitIn(
    options.worktree,
    changed.map(({ file }) => `${options.prefix}${file}`),
    `ork: canonical form${run}`,
  );
  if (refused !== null) {
    problems.push(`canonical commit refused: ${refused}`);
    return;
  }
  // A commit hook may have rewritten a file the serializer just wrote.
  for (const { file, text } of changed) {
    const after = readInWorktree(options, file);
    if (!("text" in after) || after.text !== text) {
      problems.push(`${file}: rewritten by a commit hook, no longer canonical`);
    }
  }
};

/** `ork validate`'s errors, plain and under each ready driver. */
const validationProblems = async (
  options: Scene,
  reads: readonly Read[],
): Promise<string[]> => {
  const checks = options.checks ?? checksHere;
  const ready = (await checks())
    .filter(({ result }) => result.status === "ok")
    .map(({ id }) => id);
  const problems = new Set<string>();
  for (const { file } of reads) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- a walk's limit is on the clock
    const loaded = await walkLoaded(
      loadWorkflow(file, path.join(options.worktree, options.prefix)),
    );
    const errors = [...loaded.report.diagnostics];
    if (loaded.workflow !== null) {
      for (const override of [undefined, ...ready]) {
        errors.push(
          // oxlint-disable-next-line eslint/no-await-in-loop -- same
          ...(await driverDiagnostics(loaded.workflow, { override, checks })),
        );
      }
    }
    for (const d of errors) {
      if (d.severity === "error")
        problems.add(`${file}: ${d.code} ${d.message}`);
    }
  }
  return [...problems];
};

/** What a person should look at, against the files at `HEAD`. */
const eyeList = (
  options: Scene,
  reads: readonly Read[],
  project: boolean,
): string[] => {
  const items = reads.flatMap(({ file, workflow }) => {
    const old = textAtHead(options.root, file);
    const parsed = old === null ? null : parseWorkflow(old);
    const before = parsed?.ok === true ? eyeOfWorkflow(parsed.workflow) : [];
    const now = eyeOfWorkflow(workflow);
    const deleted = Object.keys(
      parsed?.ok === true ? parsed.workflow.nodes : {},
    ).filter(id => !(id in workflow.nodes));
    return [
      ...newItems(now, before),
      ...collapseRemovedNodes(removedItems(now, before), deleted),
    ].map(item => `${file}: ${item}`);
  });
  if (!project) return items;
  const read = readInWorktree(options, PROJECT_FILE);
  const now = "text" in read ? parseProject(read.text) : null;
  if (now?.ok !== true) return items;
  const old = textAtHead(options.root, PROJECT_FILE);
  const parsed = old === null ? null : parseProject(old);
  const before = parsed?.ok === true ? eyeOfProject(parsed.project) : [];
  const eye = eyeOfProject(now.project);
  return [
    ...items,
    ...[...newItems(eye, before), ...removedItems(eye, before)].map(
      item => `${PROJECT_FILE}: ${item}`,
    ),
  ];
};

/** Checks the writer's work; `problems` is empty when it passes. */
export const finish = async (given: FinishOptions): Promise<FinishReport> => {
  const options: Scene = { ...given, prefix: projectPrefix(given.root) };
  const problems: string[] = [];
  const scope = scopeOf(options, problems);
  const reads = readWorkflows(options, scope.workflows, problems);
  if (scope.project) {
    const read = readInWorktree(options, PROJECT_FILE);
    if ("error" in read) problems.push(`${PROJECT_FILE}: ${read.error}`);
    else {
      const parsed = parseProject(read.text);
      if (!parsed.ok) {
        for (const d of parsed.diagnostics) {
          problems.push(`${PROJECT_FILE}: ${d.code} ${d.message}`);
        }
      }
    }
  }
  canonicalize(options, reads, problems);
  problems.push(...(await validationProblems(options, reads)));
  return { problems, eye: eyeList(options, reads, scope.project) };
};

const section = (title: string, items: readonly string[]): string[] => [
  `${title}:`,
  ...(items.length === 0
    ? ["- none"]
    : items.map(item => `- ${item.replaceAll(/\s+/gu, " ")}`)),
];

/** The two sections `finish` prints, each item a line. */
export const finishText = (report: FinishReport): string =>
  `${[...section("problems", report.problems), ...section("needs your eye", report.eye)].join("\n")}\n`;
