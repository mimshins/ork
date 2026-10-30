/**
 * @file Flow edges: expanding shorthand, parsing `when:`, bounded cycles, entry
 *   nodes, reachability and upstream nodes.
 */

import { type Diagnostic, expandEdge, type Workflow } from "@krapht/ork-schema";

import { parseExpr } from "../expr/parse.ts";
import { error, warning } from "./diagnostics.ts";
import type { CompiledEdge } from "./types.ts";

export type FlowResult = {
  edges: CompiledEdge[];
  diagnostics: Diagnostic[];
};

/** Expands the authored edges, checks their endpoints and parses `when:`. */
export const compileEdges = (workflow: Workflow): FlowResult => {
  const diagnostics: Diagnostic[] = [];
  const edges: CompiledEdge[] = [];
  const seen = new Set<string>();

  for (const [index, input] of (workflow.edges ?? []).entries()) {
    const path = ["edges", index];
    const expanded = expandEdge(input, index);
    if (!expanded.ok) {
      diagnostics.push(error("edge.syntax", expanded.message, path));
      continue;
    }
    for (const edge of expanded.edges) {
      const label = `${edge.from} -> ${edge.to}`;
      const missing = [edge.from, edge.to].filter(
        id => workflow.nodes[id] === undefined,
      );
      if (missing.length > 0) {
        diagnostics.push(
          error(
            "edge.unknown-node",
            `edge ${label}: unknown node ${missing.map(m => `"${m}"`).join(", ")}`,
            path,
          ),
        );
        continue;
      }
      const subagent = [edge.from, edge.to].find(
        id => workflow.nodes[id]?.type === "claude.subagent",
      );
      if (subagent !== undefined) {
        diagnostics.push(
          error(
            "edge.subagent",
            `edge ${label}: "${subagent}" is a sub-agent; it runs inside its parent's session and takes no edges`,
            path,
          ),
        );
        continue;
      }
      const key = `${edge.from}\u0000${edge.to}\u0000${edge.when ?? ""}`;
      if (seen.has(key)) {
        diagnostics.push(
          warning("edge.duplicate", `edge ${label} is declared twice`, path),
        );
      }
      seen.add(key);

      const compiled: CompiledEdge = { ...edge };
      if (edge.when !== undefined) {
        const parsed = parseExpr(edge.when);
        if (parsed.ok) {
          compiled.condition = parsed.expr;
        } else {
          diagnostics.push(
            error(
              "edge.when-syntax",
              `when: ${parsed.message} at column ${parsed.offset + 1}`,
              [...path, "when"],
            ),
          );
        }
      }
      edges.push(compiled);
    }
  }
  return { edges, diagnostics };
};

/** Tarjan's strongly connected components over `ids` and `edges`. */
const stronglyConnected = (
  ids: readonly string[],
  edges: readonly CompiledEdge[],
): string[][] => {
  const adjacency = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to);

  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (id: string) => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) ?? 0, index.get(next) ?? 0));
      }
    }
    if (low.get(id) === index.get(id)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member !== undefined) {
          onStack.delete(member);
          component.push(member);
        }
      } while (member !== undefined && member !== id);
      components.push(component);
    }
  };

  for (const id of ids) if (!index.has(id)) visit(id);
  return components;
};

const reachable = (
  from: readonly string[],
  edges: readonly CompiledEdge[],
): Set<string> => {
  const seen = new Set(from);
  const queue = [...from];
  while (queue.length > 0) {
    const id = queue.shift();
    for (const edge of edges) {
      if (edge.from === id && !seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return seen;
};

/**
 * Every cycle needs at least one edge with `maxRounds`, so every loop is
 * bounded. A `maxRounds` on an edge outside any cycle has no effect.
 */
export const checkCycles = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
): Diagnostic[] => {
  const ids = Object.keys(workflow.nodes);
  const unbounded = edges.filter(e => e.maxRounds === undefined);
  const diagnostics: Diagnostic[] = [];

  for (const component of stronglyConnected(ids, unbounded)) {
    const [only] = component;
    const selfLoop =
      component.length === 1 &&
      unbounded.some(e => e.from === only && e.to === only);
    if (component.length > 1 || selfLoop) {
      const members = component.toReversed();
      const first = unbounded.find(
        e => members.includes(e.from) && members.includes(e.to),
      );
      diagnostics.push(
        error(
          "graph.unbounded-cycle",
          `cycle through ${members.join(", ")} has no edge with maxRounds`,
          first === undefined ? ["edges"] : ["edges", first.source],
        ),
      );
    }
  }

  for (const edge of edges) {
    if (edge.maxRounds === undefined) continue;
    if (!reachable([edge.to], edges).has(edge.from)) {
      diagnostics.push(
        warning(
          "edge.max-rounds-unused",
          `edge ${edge.from} -> ${edge.to} is not part of a cycle; maxRounds has no effect`,
          ["edges", edge.source, "maxRounds"],
        ),
      );
    }
  }
  return diagnostics;
};

/**
 * Entries start with the run: no incoming edge and no owner. An owned node with
 * no incoming edge runs only when its owner delegates to it.
 */
export const findEntries = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
): string[] =>
  Object.entries(workflow.nodes)
    .filter(
      ([id, node]) =>
        node.parent === undefined && !edges.some(e => e.to === id),
    )
    .map(([id]) => id);

/** Nodes no entry can reach through edges or ownership. */
export const findUnreachable = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
  entries: readonly string[],
): string[] => {
  const ownership: CompiledEdge[] = Object.entries(workflow.nodes).flatMap(
    ([id, node]) =>
      node.parent === undefined
        ? []
        : [{ from: node.parent, to: id, source: -1 }],
  );
  const seen = reachable(entries, [...edges, ...ownership]);
  return Object.keys(workflow.nodes).filter(id => !seen.has(id));
};

/** Nodes whose output can exist before `id` runs (flow ancestors). */
export const ancestorsOf = (
  id: string,
  edges: readonly CompiledEdge[],
): Set<string> => {
  const reversed = edges.map(e => ({ ...e, from: e.to, to: e.from }));
  const seen = reachable([id], reversed);
  seen.delete(id);
  return seen;
};
