import type { Scope } from "../expr/evaluate.ts";
import type { Inputs, NodeOutput } from "./types.ts";

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
