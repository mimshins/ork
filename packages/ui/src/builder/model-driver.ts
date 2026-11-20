/**
 * @file What the builder says of a node's `model` that names its driver
 *   (`claude-code.sonnet`, RFC-015): where it runs, and whether it contradicts
 *   the node's own `driver`. A value with `{{…}}` in it is read at run time, so
 *   it is left alone.
 */

import {
  DRIVER_CHOICES,
  driverOf,
  type WorkflowGraph,
} from "@krapht/ork-server/client";

import { itemFieldsOf } from "./for-each-model.ts";

/** What the model says of its driver; empty for a plain or templated model. */
const namedDriver = (model: unknown): string | undefined =>
  typeof model !== "string" || model.includes("{{")
    ? undefined
    : driverOf(model, DRIVER_CHOICES).driver;

const MODEL_HINT =
  "A model for the run's driver, or `<driver>.<model>`, such as `claude-code.sonnet`.";

/** The model field's hint: the form of a value, and where this one runs. */
export const modelHint = (model: unknown, description?: string): string => {
  const driver = namedDriver(model);
  return [
    description ?? MODEL_HINT,
    ...(driver === undefined ? [] : [`Runs on ${driver}.`]),
  ].join(" ");
};

/** A node's own `model` or `effort`: a template may fill it (RFC-029). */
export const isSettingPath = (path: readonly (string | number)[]): boolean =>
  path[0] === "nodes" &&
  path.length === 3 &&
  (path[2] === "model" || path[2] === "effort");

/**
 * A node's `model` or `effort` hint with what a template may read added, on any
 * agent node: inputs and an earlier node's output, and the item on a fanned
 * node (never `{{index}}`). A templated value adds that it is read at start.
 */
export const settingHint = (
  graph: WorkflowGraph,
  node: Record<string, unknown>,
  field: "model" | "effort",
  description?: string,
): string => {
  const { forEach } = node;
  const value = node[field];
  const fanned = typeof forEach === "object" && forEach !== null;
  const fields = fanned ? itemFieldsOf(graph, forEach) : [];
  const item =
    fields.length === 0
      ? "`{{item.<field>}}`"
      : fields.map(name => `\`{{item.${name}}}\``).join(", ");
  const reads = `Reads \`{{inputs.<name>}}\` and \`{{nodes.<id>.output.<field>}}\` of a node that runs first${
    fanned ? `, and ${item}` : ""
  }.`;
  const starts =
    typeof value === "string" && value.includes("{{")
      ? "Read when the node starts."
      : undefined;
  const own = description ?? (field === "model" ? MODEL_HINT : undefined);
  return [own, reads, starts].filter(Boolean).join(" ");
};

/** The error for a model whose prefix is not the node's `driver`, if any. */
export const modelClash = (
  model: unknown,
  nodeDriver: unknown,
): string | undefined => {
  const driver = namedDriver(model);
  return driver === undefined ||
    typeof nodeDriver !== "string" ||
    nodeDriver === driver
    ? undefined
    : `Model names ${driver}, but this node's driver is ${nodeDriver}. Make them match, or drop the prefix.`;
};

/**
 * A node's `model`, or the workflow's default one: each has a `driver` beside
 * it.
 */
export const isModelPath = (path: readonly (string | number)[]): boolean =>
  path.at(-1) === "model" &&
  ((path[0] === "nodes" && path.length === 3) ||
    (path[0] === "defaults" && path.length === 2));
