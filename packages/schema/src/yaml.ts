/**
 * @file Workflow and project YAML: parsing with source positions for
 *   diagnostics, and the workflow's byte-stable canonical serializer.
 */

import {
  type Document,
  isNode,
  LineCounter,
  parseDocument,
  stringify,
} from "yaml";
import type { z } from "zod";

import { AgentSchema } from "./agents.ts";
import { formatEdge } from "./edges.ts";
import { NodeSchema, type NodeType } from "./nodes.ts";
import { type Project, ProjectSchema } from "./project.ts";
import {
  type Layout,
  LayoutSchema,
  SCHEMA_VERSION,
  type Workflow,
  WorkflowSchema,
} from "./workflow.ts";

export type DiagnosticPath = readonly (string | number)[];

export type Diagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  path: DiagnosticPath;
  line?: number;
  column?: number;
};

/** Maps a path inside the workflow to a position in the source text. */
export type Locate = (
  path: DiagnosticPath,
) => { line: number; column: number } | null;

export type LoadResult =
  | { ok: true; workflow: Workflow; locate: Locate }
  | { ok: false; diagnostics: Diagnostic[]; locate: Locate };

export const SCHEMA_URL =
  "https://raw.githubusercontent.com/mimshins/ork/main/packages/schema/workflow.schema.json";

const NODE_TYPES = NodeSchema.options.map(o => o.shape.type.value);

const createLocate =
  (doc: Document, counter: LineCounter): Locate =>
  path => {
    // Walk up to the nearest ancestor that exists in the document.
    for (let depth = path.length; depth >= 0; depth -= 1) {
      const node = doc.getIn(path.slice(0, depth), true);
      if (isNode(node) && node.range) {
        const { line, col } = counter.linePos(node.range[0]);
        return { line, column: col };
      }
    }
    return null;
  };

const toPath = (path: readonly PropertyKey[]): (string | number)[] =>
  path.map(p => (typeof p === "number" ? p : String(p)));

const describeIssue = (
  issue: z.core.$ZodIssue,
  raw: unknown,
  path: (string | number)[],
): { message: string; path: (string | number)[] } => {
  if (issue.code === "unrecognized_keys") {
    const [first] = issue.keys;
    return {
      message: `unknown key${issue.keys.length > 1 ? "s" : ""}: ${issue.keys.join(", ")}`,
      path: first === undefined ? path : [...path, first],
    };
  }
  if (issue.code === "invalid_union" && issue.discriminator === "type") {
    // The issue path ends at the `type` key itself.
    let value: unknown = raw;
    for (const segment of path) {
      value =
        value !== null && typeof value === "object"
          ? (Reflect.get(value, segment) as unknown)
          : undefined;
    }
    return {
      message:
        value === undefined
          ? `node needs a "type": one of ${NODE_TYPES.join(", ")}`
          : `unknown node type ${JSON.stringify(value)}: expected one of ${NODE_TYPES.join(", ")}`,
      path,
    };
  }
  return { message: issue.message, path };
};

const withPosition = (diagnostic: Diagnostic, locate: Locate): Diagnostic => {
  const pos = locate(diagnostic.path);
  return pos === null ? diagnostic : { ...diagnostic, ...pos };
};

type Parsed<T> =
  | { ok: true; data: T; locate: Locate }
  | { ok: false; diagnostics: Diagnostic[]; locate: Locate };

/** Parses YAML text and validates it against `schema`, with positions. */
const parseWith = <T>(text: string, schema: z.ZodType<T>): Parsed<T> => {
  const counter = new LineCounter();
  const doc = parseDocument(text, {
    lineCounter: counter,
    prettyErrors: false,
  });
  const locate = createLocate(doc, counter);

  if (doc.errors.length > 0) {
    return {
      ok: false,
      locate,
      diagnostics: doc.errors.map(error => {
        const pos = counter.linePos(error.pos[0]);
        return {
          severity: "error",
          code: "yaml.syntax",
          message: error.message.split("\n")[0] ?? error.message,
          path: [],
          line: pos.line,
          column: pos.col,
        };
      }),
    };
  }

  const raw: unknown = doc.toJS();
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      locate,
      diagnostics: result.error.issues.map(issue => {
        const described = describeIssue(issue, raw, toPath(issue.path));
        return withPosition(
          {
            severity: "error",
            code: `schema.${issue.code}`,
            message: described.message,
            path: described.path,
          },
          locate,
        );
      }),
    };
  }
  return { ok: true, data: result.data, locate };
};

/** Parses and structurally validates a workflow file. */
export const parseWorkflow = (text: string): LoadResult => {
  const parsed = parseWith(text, WorkflowSchema);
  return parsed.ok
    ? { ok: true, workflow: parsed.data, locate: parsed.locate }
    : parsed;
};

export type ProjectLoadResult =
  | { ok: true; project: Project; locate: Locate }
  | { ok: false; diagnostics: Diagnostic[]; locate: Locate };

/** Parses and structurally validates a project's `.ork/project.yaml`. */
export const parseProject = (text: string): ProjectLoadResult => {
  const parsed = parseWith(text, ProjectSchema);
  return parsed.ok
    ? { ok: true, project: parsed.data, locate: parsed.locate }
    : parsed;
};

const TOP_LEVEL_ORDER = Object.keys(WorkflowSchema.shape);

const AGENT_ORDER = Object.keys(AgentSchema.shape);

const SHAPE_ORDER = new Map<NodeType, string[]>(
  NodeSchema.options.map(o => [o.shape.type.value, Object.keys(o.shape)]),
);

/**
 * Returns a copy of `value` with `order` keys first (in that order), then any
 * remaining keys in their original order. Undefined values are dropped.
 */
const ordered = (
  value: Record<string, unknown>,
  order: readonly string[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of [
    ...order,
    ...Object.keys(value).filter(k => !order.includes(k)),
  ]) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
};

/**
 * Serializes a workflow in canonical form: fixed key order, node ids in
 * authored order, edges in shorthand where possible. The output is byte-stable:
 * `serialize(parse(serialize(w))) === serialize(w)`.
 *
 * Comments are not preserved.
 */
export const serializeWorkflow = (workflow: Workflow): string => {
  const nodes: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(workflow.nodes)) {
    nodes[id] = ordered(node, SHAPE_ORDER.get(node.type) ?? []);
  }
  const agents =
    workflow.agents === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(workflow.agents).map(([name, agent]) => [
            name,
            ordered(agent, AGENT_ORDER),
          ]),
        );
  const canonical = ordered(
    {
      ...workflow,
      agents,
      nodes,
      edges: workflow.edges?.map(formatEdge),
    },
    TOP_LEVEL_ORDER,
  );
  const body = stringify(canonical, { lineWidth: 0, indent: 2 });
  return `# yaml-language-server: $schema=${SCHEMA_URL}\n${body}`;
};

export const parseLayout = (
  text: string,
): { ok: true; layout: Layout } | { ok: false; message: string } => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "invalid JSON",
    };
  }
  const result = LayoutSchema.safeParse(raw);
  return result.success
    ? { ok: true, layout: result.data }
    : { ok: false, message: result.error.issues[0]?.message ?? "invalid" };
};

/** Layout JSON with node ids sorted, so moving one node is a one-line diff. */
export const serializeLayout = (layout: Layout): string => {
  const nodes: Layout["nodes"] = {};
  for (const id of Object.keys(layout.nodes).toSorted()) {
    const position = layout.nodes[id];
    if (position !== undefined) nodes[id] = { x: position.x, y: position.y };
  }
  return `${JSON.stringify(
    { schemaVersion: SCHEMA_VERSION, nodes, viewport: layout.viewport },
    undefined,
    2,
  )}\n`;
};
