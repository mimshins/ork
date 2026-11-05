/**
 * @file The checks on a workflow's flow and what its nodes refer to, together,
 *   in the order they report.
 */

import type { Diagnostic, Workflow } from "@krapht/ork-schema";

import { checkCalls } from "./calls.ts";
import { checkConditions } from "./condition-checks.ts";
import { checkCycles } from "./flow.ts";
import { checkLoops } from "./loops.ts";
import { checkNodes } from "./nodes.ts";
import type { CompiledRule } from "./notify.ts";
import { checkReferences } from "./refs.ts";
import type { CompiledEdge } from "./types.ts";

export const checkFlow = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
  rules: ReadonlyMap<string, readonly CompiledRule[]>,
): Diagnostic[] => [
  ...checkCycles(workflow, edges),
  ...checkLoops(workflow, edges),
  ...checkNodes(workflow, edges),
  ...checkCalls(workflow),
  ...checkReferences(workflow, edges, rules),
  ...checkConditions(workflow, edges, rules),
];
