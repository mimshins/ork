/**
 * @file `ork __onboard finish --worktree <path> --branch <branch>`: checks what
 *   the onboarding writer left in its worktree, in the project root. Scope
 *   (only `.ork/workflows/*.ork.yaml` and `.ork/project.yaml`), caps, no
 *   `driver` or `model`, only Ork's agents, canonical form (committed in the
 *   worktree), validation under every ready driver, then the list of what a
 *   person should look at. It reads the worktree through the plain-file guards
 *   and runs nothing the model drafted (specs/cli/onboard-verbs.md#finish).
 */

import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { plainPathInside, writePlainFile } from "@krapht/ork-core";
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
  eyeOfProject,
  eyeOfWorkflow,
  newItems,
  workflowProblems,
} from "./finish-checks.ts";
import {
  type Change,
  changesOf,
  commitIn,
  isAllowedPath,
  textAtHead,
} from "./finish-git.ts";

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

/** A file of the worktree's text, or the reason it cannot be read. */
const readInWorktree = (
  worktree: string,
  file: string,
): { text: string } | { error: string } => {
  const absolute = path.join(worktree, file);
  if (!plainPathInside(worktree, absolute)) {
    return { error: "is a link, or behind one" };
  }
  try {
    if (!lstatSync(absolute).isFile()) return { error: "is not a file" };
    return { text: readFileSync(absolute, "utf8") };
  } catch {
    return { error: "cannot be read" };
  }
};

/** The scope check: what changed, the problems, and the files to read. */
const scopeOf = (
  options: FinishOptions,
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

/** Reads and checks each workflow file: schema, caps, names. */
const readWorkflows = (
  options: FinishOptions,
  files: readonly string[],
  problems: string[],
): Read[] => {
  const reads: Read[] = [];
  for (const file of files) {
    const read = readInWorktree(options.worktree, file);
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
    for (const message of workflowProblems(parsed.workflow)) {
      problems.push(`${file}: ${message}`);
    }
    reads.push({ file, workflow: parsed.workflow });
  }
  return reads;
};

/** Rewrites each file through the serializer and commits what changed. */
const canonicalize = (
  options: FinishOptions,
  reads: readonly Read[],
  problems: string[],
): void => {
  const changed: { file: string; text: string }[] = [];
  for (const { file, workflow } of reads) {
    const text = serializeWorkflow(workflow);
    const now = readInWorktree(options.worktree, file);
    if ("text" in now && now.text === text) continue;
    const absolute = path.join(options.worktree, file);
    const written = writePlainFile(options.worktree, absolute, text, file);
    if (written.ok) changed.push({ file, text });
    else problems.push(`${file}: ${written.error}`);
  }
  if (changed.length === 0) return;
  const run = options.run === undefined ? "" : ` (run ${options.run})`;
  const refused = commitIn(
    options.worktree,
    changed.map(({ file }) => file),
    `ork: canonical form${run}`,
  );
  if (refused !== null) {
    problems.push(`canonical commit refused: ${refused}`);
    return;
  }
  // A commit hook may have rewritten a file the serializer just wrote.
  for (const { file, text } of changed) {
    const after = readInWorktree(options.worktree, file);
    if (!("text" in after) || after.text !== text) {
      problems.push(`${file}: rewritten by a commit hook, no longer canonical`);
    }
  }
};

/** `ork validate`'s errors, plain and under each ready driver. */
const validationProblems = async (
  options: FinishOptions,
  reads: readonly Read[],
): Promise<string[]> => {
  const checks = options.checks ?? checksHere;
  const ready = (await checks())
    .filter(({ result }) => result.status === "ok")
    .map(({ id }) => id);
  const problems = new Set<string>();
  for (const { file } of reads) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- a walk's limit is on the clock
    const loaded = await walkLoaded(loadWorkflow(file, options.worktree));
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
  options: FinishOptions,
  reads: readonly Read[],
  project: boolean,
): string[] => {
  const items = reads.flatMap(({ file, workflow }) => {
    const old = textAtHead(options.root, file);
    const parsed = old === null ? null : parseWorkflow(old);
    const before = parsed?.ok === true ? eyeOfWorkflow(parsed.workflow) : [];
    return newItems(eyeOfWorkflow(workflow), before).map(
      item => `${file}: ${item}`,
    );
  });
  if (!project) return items;
  const read = readInWorktree(options.worktree, PROJECT_FILE);
  const now = "text" in read ? parseProject(read.text) : null;
  if (now?.ok !== true) return items;
  const old = textAtHead(options.root, PROJECT_FILE);
  const parsed = old === null ? null : parseProject(old);
  const before = parsed?.ok === true ? eyeOfProject(parsed.project) : [];
  return [
    ...items,
    ...newItems(eyeOfProject(now.project), before).map(
      item => `${PROJECT_FILE}: ${item}`,
    ),
  ];
};

/** Checks the writer's work; `problems` is empty when it passes. */
export const finish = async (options: FinishOptions): Promise<FinishReport> => {
  const problems: string[] = [];
  const scope = scopeOf(options, problems);
  const reads = readWorkflows(options, scope.workflows, problems);
  if (scope.project) {
    const read = readInWorktree(options.worktree, PROJECT_FILE);
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
