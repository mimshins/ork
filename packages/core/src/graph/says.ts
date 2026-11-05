/**
 * @file What each node can say (RFC-010): its fields and, where they're known,
 *   their values. One list, so the builder's choices and the checks that read
 *   it can't disagree. A router or split says what the node before it said.
 */

import { isToolNode, type Node } from "@krapht/ork-schema";

import { declaredOutputOf, REPORT_STATUSES } from "./types.ts";

export type SaidValue = string | number | boolean;

export type SaidField = {
  /** How a condition on the node's edge reads it: `status`, `json.state`. */
  field: string;
  kind: "values" | "statuses" | "number" | "boolean" | "text";
  /** The values it can have, for `values` and `statuses`. */
  values?: readonly SaidValue[];
  /** Others can occur too, so these suggest and nothing checks against them. */
  open?: true;
};

export type NodeSays = {
  fields: readonly SaidField[];
  /** Whether an edge can handle it failing. */
  canFail: boolean;
  /** Whether more fields can be declared on it, under `json`. */
  canDeclare: boolean;
};

type Link = { readonly from: string; readonly to: string; maxRounds?: unknown };

const NOTHING: NodeSays = { fields: [], canFail: false, canDeclare: false };

const isScalar = (value: unknown): value is SaidValue =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

/** One declared field: a list, a type, or JSON Schema with an `enum`. */
const declaredField = (field: string, rule: unknown): SaidField => {
  const list =
    typeof rule === "object" && rule !== null && "enum" in rule
      ? rule.enum
      : rule;
  if (Array.isArray(list)) {
    return {
      field,
      kind: "values",
      values: list.filter(item => isScalar(item)),
    };
  }
  if (rule === "number" || rule === "integer") return { field, kind: "number" };
  return rule === "boolean"
    ? { field, kind: "boolean" }
    : { field, kind: "text" };
};

const declaredFields = (node: Node, prefix: string): SaidField[] =>
  Object.entries(declaredOutputOf(node) ?? {}).map(([name, rule]) =>
    declaredField(`${prefix}${name}`, rule),
  );

const optionIds = (node: Node): readonly string[] =>
  node.type === "human.gate"
    ? node.options.map(option =>
        typeof option === "string" ? option : option.id,
      )
    : [];

/** A session with no good report has `status: fail`, whatever is declared. */
const withFail = (said: SaidField): SaidField =>
  said.field === "status" && said.values !== undefined
    ? { ...said, values: [...new Set([...said.values, "fail"])] }
    : said;

/** What a node says on its own; a router or split says nothing of its own. */
const ownSays = (node: Node): NodeSays => {
  if (isToolNode(node)) {
    return {
      fields: [
        { field: "exitCode", kind: "number" },
        { field: "stdout", kind: "text" },
        { field: "stderr", kind: "text" },
        ...declaredFields(node, "json."),
      ],
      canFail: true,
      canDeclare: node.output?.format === "json",
    };
  }
  if (node.type === "human.gate") {
    return {
      fields: [{ field: "choice", kind: "values", values: optionIds(node) }],
      canFail: false,
      canDeclare: false,
    };
  }
  if (node.type === "mcp.call") {
    return {
      fields: [
        { field: "text", kind: "text" },
        ...declaredFields(node, "json."),
      ],
      canFail: true,
      canDeclare: true,
    };
  }
  if (node.type === "workflow.call") {
    return {
      fields: [
        // A call reports what it called, so any status can come back.
        {
          field: "status",
          kind: "values",
          values: ["pass", "fail"],
          open: true,
        },
        { field: "summary", kind: "text" },
      ],
      canFail: true,
      canDeclare: false,
    };
  }
  if (!node.type.startsWith("claude.")) return NOTHING;
  const declared = declaredFields(node, "").map(field => withFail(field));
  return {
    fields: [
      ...(declared.some(({ field }) => field === "status")
        ? []
        : [
            {
              field: "status",
              kind: "values" as const,
              values: REPORT_STATUSES,
            },
          ]),
      { field: "summary", kind: "text" },
      ...declared,
    ],
    canFail: true,
    canDeclare: false,
  };
};

const forwardInputsOf = (id: string, links: readonly Link[]): string[] =>
  links
    .filter(({ to, maxRounds }) => to === id && maxRounds === undefined)
    .map(({ from }) => from);

/** Every edge into a node: a loop edge brings its source's output too. */
const allInputsOf = (id: string, links: readonly Link[]): string[] =>
  links.filter(({ to }) => to === id).map(({ from }) => from);

/**
 * What a node says, reading through routers and splits to the node before, and
 * from a join's inputs. A pass-through with several inputs can't be known.
 */
const saysOf = (
  id: string,
  nodes: Readonly<Record<string, Node>>,
  links: readonly Link[],
  seen: ReadonlySet<string>,
): NodeSays => {
  const node = nodes[id];
  if (node === undefined || seen.has(id)) return NOTHING;
  const next = new Set([...seen, id]);
  if (node.type === "control.router" || node.type === "control.split") {
    const inputs = allInputsOf(id, links);
    const [only] = inputs;
    return only === undefined || inputs.length > 1
      ? NOTHING
      : {
          ...saysOf(only, nodes, links, next),
          canFail: false,
          canDeclare: false,
        };
  }
  if (node.type === "control.join") {
    const sources = forwardInputsOf(id, links).map(input =>
      saysOf(input, nodes, links, next).fields.find(
        ({ field }) => field === "status",
      ),
    );
    const statuses = sources.flatMap(source => source?.values ?? []);
    // An input with no known list can bring any status, or none.
    const open =
      sources.length === 0 ||
      sources.some(
        source => source?.values === undefined || source.open === true,
      );
    return {
      fields: [
        {
          field: "statuses",
          kind: "statuses",
          values: [...new Set(statuses)],
          ...(open ? { open } : {}),
        },
        { field: "count", kind: "number" },
      ],
      canFail: false,
      canDeclare: false,
    };
  }
  return ownSays(node);
};

/** What each node can say. */
export const nodeSays = (
  nodes: Readonly<Record<string, Node>>,
  links: readonly Link[],
): Record<string, NodeSays> =>
  Object.fromEntries(
    Object.keys(nodes).map(id => [id, saysOf(id, nodes, links, new Set())]),
  );
