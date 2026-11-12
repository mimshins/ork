/**
 * @file What the builder means, apart from how it looks: which problems belong
 *   to which node, what its cards say, a new node's id, and which nodes act
 *   beyond their worktree, which a real run has to name first.
 */

import {
  type Diagnostic,
  diagnosticText,
  type WorkflowGraph,
} from "@krapht/ork-server/client";

import type { NodeFacts } from "../graph/facts.ts";
import { labelOf } from "./schema-model.ts";

/** The node a problem is about, if it is about one. */
export const nodeOfProblem = (problem: Diagnostic): string | undefined => {
  const [root, id] = problem.path;
  return root === "nodes" && typeof id === "string" ? id : undefined;
};

/**
 * What a problem says, in plain words. The format's checks say what they
 * expected; of a field left empty, a person only needs to hear that it's
 * needed.
 */
export const problemWords = (problem: Diagnostic): string => {
  const last = problem.path.at(-1);
  return problem.message.endsWith("received undefined") &&
    typeof last === "string"
    ? `${labelOf(last)} is required.`
    : diagnosticText(problem);
};

/** The errors and warnings on each node. */
const problemsByNode = (
  problems: readonly Diagnostic[],
): ReadonlyMap<string, Diagnostic[]> => {
  const byNode = new Map<string, Diagnostic[]>();
  for (const problem of problems) {
    const id = nodeOfProblem(problem);
    if (id !== undefined) byNode.set(id, [...(byNode.get(id) ?? []), problem]);
  }
  return byNode;
};

const plural = (count: number, word: string): string =>
  `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/** What each card says: its problems, in place of a run's status. */
export const factsOf = (
  graph: WorkflowGraph,
  problems: readonly Diagnostic[],
): ReadonlyMap<string, NodeFacts> => {
  const byNode = problemsByNode(problems);
  // A file the format refuses never reaches the compiler, so a card with no
  // problem so far may still have one.
  const checked = !problems.some(({ code }) => /^(schema|yaml)\./u.test(code));
  return new Map(
    graph.nodes.map(({ id }): [string, NodeFacts] => {
      const own = byNode.get(id) ?? [];
      const errors = own.filter(p => p.severity === "error").length;
      const warnings = own.length - errors;
      if (errors > 0) {
        return [id, { status: "failed", word: plural(errors, "error") }];
      }
      return warnings > 0
        ? [id, { status: "waiting", word: plural(warnings, "warning") }]
        : [
            id,
            {
              status: "queued",
              word: checked ? "no problems" : "not checked yet",
            },
          ];
    }),
  );
};

/** The problems at exactly this path, for the field that holds it. */
export const problemsAt = (
  problems: readonly Diagnostic[],
  path: readonly (string | number)[],
): Diagnostic[] =>
  problems.filter(
    problem =>
      problem.path.length === path.length &&
      problem.path.every((part, index) => part === path[index]),
  );

/** The value at `path` in a plain document. */
export const readAt = (
  document: unknown,
  path: readonly (string | number)[],
): unknown => {
  let at: unknown = document;
  for (const key of path) {
    if (Array.isArray(at) && typeof key === "number") {
      at = at[key] as unknown;
    } else if (typeof at === "object" && at !== null && !Array.isArray(at)) {
      at = Object.entries(at).find(([name]) => name === key)?.[1];
    } else {
      return undefined;
    }
  }
  return at;
};

/** Two plain values alike, as far as an edit could tell. */
export const sameJson = (a: unknown, b: unknown): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    JSON.stringify(a) === JSON.stringify(b));

export const errorCount = (problems: readonly Diagnostic[]): number =>
  problems.filter(problem => problem.severity === "error").length;

/** A new node's id: the type's last word, then `-2` and so on. */
export const newNodeId = (type: string, taken: readonly string[]): string => {
  const base = (type.split(".").at(-1) ?? "node").toLowerCase();
  if (!taken.includes(base)) return base;
  let count = 2;
  while (taken.includes(`${base}-${String(count)}`)) count += 1;
  return `${base}-${String(count)}`;
};

const ACTS_OUTSIDE = new Set([
  "tool.gh",
  "tool.aws",
  "mcp.call",
  "workflow.call",
]);

/** The nodes that change things outside the worktree, for the run's warning. */
export const actingOutside = (graph: WorkflowGraph): string[] =>
  graph.nodes
    .filter(({ type }) => ACTS_OUTSIDE.has(type))
    .map(({ id, type }) => `${id} (${type})`);

/** The nodes a message rule can write to. */
export const messageTargets = (graph: WorkflowGraph): string[] =>
  graph.nodes
    .filter(({ type }) => type === "agent.leader" || type === "agent.worker")
    .map(({ id }) => id);
