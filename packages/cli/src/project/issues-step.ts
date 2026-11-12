/**
 * @file The issues step of `ork init`: with `--issues` it writes the `issues`
 *   workflow (many issues built in parallel, integrated into one branch, one
 *   pull request) into `.ork/workflows/`, with `--no-issues` it doesn't, and
 *   otherwise it asks on a terminal, once, or says how to add it later. It
 *   never overwrites a file. A file it writes comes with a line naming the
 *   driver the workflow runs on and whether it is ready here.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { modelDriver } from "@krapht/ork-core";
import { parseWorkflow } from "@krapht/ork-schema";

import { confirm, style, write } from "../output.ts";
import { checksHere, type DriverChecks } from "../run/ready-driver.ts";
import { WORKFLOW_DIR, WORKFLOW_SUFFIX } from "../workflows.ts";
import { ISSUES_WORKFLOW } from "./issues-workflow.ts";

/** Where the step writes the workflow, relative to the project root. */
export const ISSUES_FILE = path.join(WORKFLOW_DIR, `issues${WORKFLOW_SUFFIX}`);

const QUESTION =
  "Add the `issues` workflow to .ork/workflows/? It builds GitHub issues in parallel, integrates them into one branch and opens one pull request that closes them.";

const HINT =
  "The `issues` workflow, which works GitHub issues in parallel into one pull request: add it with `ork init --issues`.";

/** Writes the workflow into `root`; false when the file is already there. */
export const writeIssuesWorkflow = (root: string): boolean => {
  const file = path.join(root, ISSUES_FILE);
  if (existsSync(file)) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, ISSUES_WORKFLOW);
  return true;
};

/**
 * Whether to write it: as asked, or the person's answer; null with no one to
 * ask.
 */
const wanted = (root: string, asked: boolean | undefined) => {
  if (asked !== undefined) return Promise.resolve(asked);
  // Asked once: a project that has it is not asked again.
  if (existsSync(path.join(root, ISSUES_FILE))) return Promise.resolve(false);
  return process.stdin.isTTY && process.stdout.isTTY
    ? confirm(QUESTION)
    : Promise.resolve(null);
};

/**
 * Which driver the bundled workflow runs on and whether it is ready here, in
 * one line. It reads the workflow's `defaults.model` (`claude-code.sonnet`:
 * driver, then model) and the readiness from `checks`, so nothing is
 * hard-coded.
 */
export const issuesDriverLine = async (
  checks: DriverChecks,
): Promise<string | null> => {
  const parsed = parseWorkflow(ISSUES_WORKFLOW);
  const model = parsed.ok ? parsed.workflow.defaults?.model : undefined;
  if (model === undefined) return null;
  const { driver } = modelDriver(model);
  if (driver === undefined) return null;
  const result = (await checks()).find(({ id }) => id === driver)?.result;
  const state =
    result === undefined || result.status === "ok"
      ? (result?.detail ?? "ready")
      : `not ready: ${result.hint ?? result.detail}`;
  return `issues runs on ${driver} (its model, ${model}): ${state}`;
};

export const issuesStep = async (
  root: string,
  options: { issues: boolean | undefined },
  checks: DriverChecks = checksHere,
): Promise<void> => {
  const choice = await wanted(root, options.issues);
  if (choice === null) {
    write(style("dim", HINT));
    return;
  }
  if (!choice) return;
  if (!writeIssuesWorkflow(root)) {
    write(`${style("dim", "exists")}  ${ISSUES_FILE}`);
    return;
  }
  write(`${style("green", "created")} ${ISSUES_FILE}`);
  const line = await issuesDriverLine(checks);
  if (line !== null) write(line);
};
