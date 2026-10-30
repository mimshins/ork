/**
 * @file A run's id and folder, and the scope templates and `when:` conditions
 *   read during it.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Scope } from "../expr/evaluate.ts";
import type { Inputs, NodeOutput, RunOptions } from "./types.ts";

/** The run's id (given, or a new one) and its `.ork/runs/<run>` folder. */
export const runPlace = (
  options: Pick<RunOptions, "runId" | "runDir" | "cwd">,
): { runId: string; runDir: string } => {
  const runId = options.runId ?? randomUUID().slice(0, 8);
  return {
    runId,
    runDir: options.runDir ?? path.join(options.cwd, ".ork", "runs", runId),
  };
};

/** What templates and `when:` read during a run. */
export const runScope = (
  inputs: Inputs,
  outputs: Readonly<Record<string, NodeOutput>>,
  runId?: string,
): Scope => {
  const scope: Scope = {
    inputs,
    nodes: Object.fromEntries(
      Object.entries(outputs).map(([id, output]) => [id, { output }]),
    ),
  };
  if (runId !== undefined) scope.run = { id: runId };
  return scope;
};
