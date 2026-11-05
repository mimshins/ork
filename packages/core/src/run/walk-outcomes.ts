/**
 * @file The ways each node can end in a walk (RFC-009). A gate gives each of
 *   its options, and anything else succeeds or fails, with the values its
 *   conditions read and what it says it can have. A value nothing reads can't
 *   change where a run goes, so it isn't tried: paths multiply with what's
 *   tried.
 */

import { isClaudeNode, isToolNode, type Node } from "@krapht/ork-schema";

import { nodeSays, type NodeSays } from "../graph/says.ts";
import type { CompiledGraph } from "../graph/types.ts";
import type { NodeOutput } from "./types.ts";
import { type Reads, readsOf, withValues } from "./walk-reads.ts";

export type Outcome = {
  ok: boolean;
  output: NodeOutput;
  /** How it ended, for the list of choices that led to an ending. */
  said: string;
};

/** Enough to try every pair of two fields of five values, and a few more. */
const MOST_PER_NODE = 32;

type Field = readonly [field: string, values: readonly unknown[]];
type Combo = readonly (readonly [field: string, value: unknown])[];

/** A node's output on success, on failure, and what can vary when it fails. */
type Shape = {
  succeeds: NodeOutput;
  fails: NodeOutput | null;
  varyOnFailure: readonly string[];
};

const shapeOf = (node: Node): Shape => {
  if (isToolNode(node)) {
    const empty = { stdout: "", stderr: "" };
    return {
      succeeds: { exitCode: 0, ...empty },
      fails: { exitCode: 1, ...empty },
      varyOnFailure: ["exitCode", "stdout", "stderr"],
    };
  }
  if (node.type === "human.gate") {
    return { succeeds: { answeredBy: "user" }, fails: null, varyOnFailure: [] };
  }
  if (isClaudeNode(node) || node.type === "workflow.call") {
    return {
      succeeds: { status: "pass", summary: "" },
      fails: { status: "fail", summary: "" },
      varyOnFailure: [],
    };
  }
  return {
    succeeds: node.type === "mcp.call" ? { text: "" } : {},
    fails: {},
    varyOnFailure: [],
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A copy with a dotted field set; own properties only, whatever it's named. */
const withField = (
  output: NodeOutput,
  [head, ...rest]: readonly string[],
  value: unknown,
): NodeOutput => {
  if (head === undefined) return output;
  const inner: unknown = Object.hasOwn(output, head)
    ? Reflect.get(output, head)
    : undefined;
  const next =
    rest.length === 0
      ? value
      : withField(isRecord(inner) ? inner : {}, rest, value);
  return Object.fromEntries([...Object.entries(output), [head, next]]);
};

const applied = (base: NodeOutput, combo: Combo): NodeOutput =>
  combo.reduce<NodeOutput>(
    (output, [field, value]) => withField(output, field.split("."), value),
    base,
  );

const combosOf = (fields: readonly Field[]): Combo[] =>
  fields.reduce<Combo[]>(
    (combos, [field, values]) =>
      combos
        .flatMap(combo =>
          values.map((value): Combo => [...combo, [field, value]]),
        )
        .slice(0, MOST_PER_NODE),
    [[]],
  );

const saidOf = (combo: Combo): string[] =>
  combo.map(([field, value]) => `${field} = ${String(value)}`);

/** The fields to vary: what's read, on the list of what it can be if closed. */
const fieldsOf = (
  node: Node,
  says: NodeSays | undefined,
  read: ReadonlyMap<string, readonly unknown[]> | undefined,
): Field[] => {
  const fields = new Map(read);
  for (const { field, values, open } of says?.fields ?? []) {
    const wanted = read?.has(field) === true || node.type === "human.gate";
    if (values !== undefined && wanted) {
      fields.set(
        field,
        open === true ? withValues(values, read?.get(field) ?? []) : values,
      );
    }
  }
  return [...fields].filter(([, values]) => values.length > 0);
};

const without = (
  fields: readonly Field[],
  field: string,
  gone: unknown,
): Field[] =>
  fields.map(
    ([name, values]) =>
      [
        name,
        name === field ? values.filter(value => value !== gone) : values,
      ] as const,
  );

const outcomesOfNode = (
  node: Node,
  says: NodeSays | undefined,
  read: ReadonlyMap<string, readonly unknown[]> | undefined,
): Outcome[] => {
  const shape = shapeOf(node);
  const fields = fieldsOf(node, says, read);
  // Exit 0 is success, whatever a condition asks, and `fail` is a failure.
  const succeeding = without(fields, "status", "fail").filter(
    ([name, values]) =>
      values.length > 0 && !(isToolNode(node) && name === "exitCode"),
  );
  const successes = combosOf(succeeding).map(combo => ({
    ok: true,
    output: applied(shape.succeeds, combo),
    said: saidOf(combo).join(", ") || "succeeded",
  }));
  if (shape.fails === null) return successes;
  const { fails } = shape;
  const failing = without(fields, "exitCode", 0).filter(
    ([name, values]) => values.length > 0 && shape.varyOnFailure.includes(name),
  );
  const failures = combosOf(failing).map(combo => ({
    ok: false,
    output: applied(fails, combo),
    said: ["failed", ...saidOf(combo)].join(", "),
  }));
  return [...successes, ...failures];
};

/** The ways each node can end, the ones a run would most hope for first. */
export const outcomesOf = (
  graph: CompiledGraph,
): {
  outcomes: ReadonlyMap<string, readonly Outcome[]>;
  cutShort: string[];
} => {
  const reads: Reads = readsOf(graph);
  const says = nodeSays(graph.workflow.nodes, graph.edges);
  const entries = [...graph.nodes].map(([id, { node }]) => ({
    id,
    fields: fieldsOf(node, says[id], reads.get(id)),
    outcomes: outcomesOfNode(node, says[id], reads.get(id)),
  }));
  return {
    outcomes: new Map(entries.map(({ id, outcomes }) => [id, outcomes])),
    cutShort: entries
      .filter(
        ({ fields }) =>
          fields.reduce((all, [, values]) => all * values.length, 1) >
          MOST_PER_NODE,
      )
      .map(({ id }) => id),
  };
};
