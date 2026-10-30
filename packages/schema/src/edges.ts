/**
 * @file Edge shorthand: expanding `a, b -> c` and the object form into single
 *   directed edges, and writing them back in the shortest form.
 */

import type { EdgeInput } from "./workflow.ts";

/** One directed flow edge after shorthand expansion. */
export type Edge = {
  from: string;
  to: string;
  when?: string;
  maxRounds?: number;
  /** Index of the authored entry in `workflow.edges`, for diagnostics. */
  source: number;
};

export type EdgeParseResult =
  | { ok: true; edges: Edge[] }
  | { ok: false; message: string };

const ARROW = "->";

const splitList = (side: string): string[] =>
  side
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0);

const asList = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value];

/**
 * Expands `"a, b -> c, d"` (or the object form) into the cartesian product of
 * edges.
 */
export const expandEdge = (
  input: EdgeInput,
  source: number,
): EdgeParseResult => {
  if (typeof input !== "string") {
    const edges = asList(input.from).flatMap(from =>
      asList(input.to).map(to => {
        const edge: Edge = { from, to, source };
        if (input.when !== undefined) edge.when = input.when;
        if (input.maxRounds !== undefined) edge.maxRounds = input.maxRounds;
        return edge;
      }),
    );
    return { ok: true, edges };
  }

  const parts = input.split(ARROW);
  if (parts.length !== 2) {
    return {
      ok: false,
      message: `edge "${input}" must have exactly one "${ARROW}"`,
    };
  }
  const [left = "", right = ""] = parts;
  const froms = splitList(left);
  const tos = splitList(right);
  if (froms.length === 0 || tos.length === 0) {
    return {
      ok: false,
      message: `edge "${input}" needs node ids on both sides of "${ARROW}"`,
    };
  }
  return {
    ok: true,
    edges: froms.flatMap(from => tos.map(to => ({ from, to, source }))),
  };
};

/**
 * Canonical authored form: the shorthand when the edge has no options, the
 * object form otherwise.
 */
export const formatEdge = (input: EdgeInput): EdgeInput => {
  if (typeof input === "string") {
    const [left = "", right = ""] = input.split(ARROW);
    return `${splitList(left).join(", ")} ${ARROW} ${splitList(right).join(", ")}`;
  }
  if (input.when === undefined && input.maxRounds === undefined) {
    return `${asList(input.from).join(", ")} ${ARROW} ${asList(input.to).join(", ")}`;
  }
  return input;
};
