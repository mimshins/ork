/**
 * @file Per-node-type checks that need the rest of the graph (joins, routers,
 *   gates, inputs), and the declared message channels.
 */

import {
  type DecisionOption,
  type Diagnostic,
  type Node,
  type Workflow,
  isClaudeNode,
  isToolNode,
  markValue,
} from "@krapht/ork-schema";

import { error, warning } from "./diagnostics.ts";
import { gatherProblems } from "./gather.ts";
import { checkItemSettings } from "./item-settings.ts";
import { checkScripts } from "./script.ts";
import {
  declaredOutputOf,
  forEachOf,
  REPORT_STATUSES,
  type CompiledEdge,
} from "./types.ts";

const optionId = (option: DecisionOption) =>
  typeof option === "string" ? option : option.id;

/**
 * A session can only report the built-in statuses, so a node that declares
 * another would fail on every run. It can narrow them, to fail on the rest.
 */
const statusProblems = (id: string, node: Node): Diagnostic[] => {
  // A sub-agent runs inside its parent's session, and has no report of its own.
  if (!isClaudeNode(node) || node.type === "claude.subagent") return [];
  const rule = declaredOutputOf(node)?.["status"];
  const list =
    typeof rule === "object" && rule !== null && "enum" in rule
      ? rule.enum
      : rule;
  if (!Array.isArray(list)) return [];
  const known: readonly unknown[] = REPORT_STATUSES;
  return list
    .filter(value => !known.includes(value))
    .map(value =>
      error(
        "output.status",
        `a session can't report \`status: ${String(value)}\`: it can only be \`${REPORT_STATUSES.join("`, `")}\`. Declare another field for this, such as \`verdict\``,
        ["nodes", id, "output", "schema", "status"],
      ),
    );
};

/** Per-type checks that need the rest of the graph. */
export const checkNodes = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [
    ...checkScripts(workflow),
    ...checkItemSettings(workflow, edges),
  ];
  for (const [id, node] of Object.entries(workflow.nodes)) {
    const path = ["nodes", id];
    const incoming = edges.filter(e => e.to === id);
    const outgoing = edges.filter(e => e.from === id);

    if (node.type === "claude.subagent" && node.timeout !== undefined) {
      diagnostics.push(
        warning(
          "timeout.subagent",
          `sub-agent \`${id}\` runs inside its parent's session, so its timeout has no effect; set one on the parent`,
          [...path, "timeout"],
        ),
      );
    }

    diagnostics.push(...statusProblems(id, node), ...gatherProblems(id, node));

    if (node.type === "control.join") {
      const sources = new Set(incoming.map(e => e.from)).size;
      if (sources < 2) {
        diagnostics.push(
          warning(
            "join.inputs",
            `join \`${id}\` has ${sources} incoming node(s); a join waits for two or more`,
            path,
          ),
        );
      }
      if (node.mode === "n" && node.n === undefined) {
        diagnostics.push(
          error("join.n", 'mode "n" needs n: <count>', [...path, "mode"]),
        );
      }
      if (node.n !== undefined && node.n > sources) {
        diagnostics.push(
          error(
            "join.n",
            `n is ${node.n} but only ${sources} node(s) feed this join`,
            [...path, "n"],
          ),
        );
      }
    }

    if (node.type === "control.router") {
      const defaults = outgoing.filter(e => e.when === undefined).length;
      if (outgoing.length > 0 && defaults === outgoing.length) {
        diagnostics.push(
          warning(
            "router.conditions",
            `router \`${id}\` has no edge with a \`when:\` condition`,
            path,
          ),
        );
      }
    }

    if (node.type === "human.gate") {
      const ids = node.options.map(optionId);
      for (const key of ["recommended", "default"] as const) {
        const value = node[key];
        if (value !== undefined && !ids.includes(value)) {
          diagnostics.push(
            error(
              "gate.option",
              `${key} ${markValue(value)} is not one of the options (${ids.map(option => markValue(option)).join(", ")})`,
              [...path, key],
            ),
          );
        }
      }
      if (new Set(ids).size !== ids.length) {
        diagnostics.push(
          error("gate.option", "option ids must be unique", [
            ...path,
            "options",
          ]),
        );
      }
      if (node.timeout !== undefined && node.default === undefined) {
        diagnostics.push(
          error(
            "gate.timeout",
            "a timeout needs a default option to choose when it expires",
            [...path, "timeout"],
          ),
        );
      }
    }
  }

  for (const [name, input] of Object.entries(workflow.inputs ?? {})) {
    if (input.required === true && input.default !== undefined) {
      diagnostics.push(
        warning(
          "input.required-default",
          `input \`${name}\` is required and has a default; the default is never used`,
          ["inputs", name],
        ),
      );
    }
  }

  return diagnostics;
};

/**
 * Declared message channels between nodes that have sessions. A tool node may
 * be on one too, one way: its program writes to the session with `ork send`.
 */
export const checkChannels = (
  workflow: Workflow,
): { channels: [string, string][]; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  const channels: [string, string][] = [];
  for (const [index, channel] of (workflow.messages ?? []).entries()) {
    const path = ["messages", index, "between"];
    const [a, b] = channel.between;
    if (a === b) {
      diagnostics.push(
        error("message.self", "a node cannot message itself", path),
      );
      continue;
    }
    const fanned = [a, b].filter(id => {
      const node = workflow.nodes[id];
      return node !== undefined && forEachOf(node) !== undefined;
    });
    if (fanned.length > 0) {
      diagnostics.push(
        error(
          "forEach.channel",
          `${fanned.map(id => `\`${id}\``).join(", ")}: a channel joins one node, and a node with \`forEach\` is one per item, which don't exist until the list is resolved`,
          path,
        ),
      );
      continue;
    }
    const bad = [a, b].filter(id => {
      const node = workflow.nodes[id];
      const talks =
        node?.type === "claude.leader" ||
        node?.type === "claude.worker" ||
        (node !== undefined && isToolNode(node)) ||
        (node?.type === "workflow.call" && node.node !== undefined);
      return !talks;
    });
    if (bad.length > 0) {
      diagnostics.push(
        error(
          "message.endpoint",
          `${bad.map(id => `\`${id}\``).join(", ")}: channels connect \`claude.leader\` and \`claude.worker\` nodes, a tool node, and a \`workflow.call\` that names a node`,
          path,
        ),
      );
      continue;
    }
    const nodeA = workflow.nodes[a];
    const nodeB = workflow.nodes[b];
    if (nodeA?.type === "workflow.call" && nodeB?.type === "workflow.call") {
      diagnostics.push(
        error(
          "message.endpoint",
          `\`${a}\`, \`${b}\`: a channel needs a session on this side, and a \`workflow.call\` has none`,
          path,
        ),
      );
      continue;
    }
    const session = (node: typeof nodeA): boolean =>
      node?.type === "claude.leader" || node?.type === "claude.worker";
    if (
      ((nodeA !== undefined && isToolNode(nodeA)) ||
        (nodeB !== undefined && isToolNode(nodeB))) &&
      !session(nodeA) &&
      !session(nodeB)
    ) {
      diagnostics.push(
        error(
          "message.endpoint",
          `\`${a}\`, \`${b}\`: a tool node writes to a session, so the other side must be a \`claude.leader\` or \`claude.worker\``,
          path,
        ),
      );
      continue;
    }
    if (nodeA?.parent === b || nodeB?.parent === a) {
      diagnostics.push(
        warning(
          "message.implicit",
          [nodeA, nodeB].some(node => node !== undefined && isToolNode(node))
            ? "a tool node can always write to its owner; this channel is not needed"
            : "a parent and its child can always message each other; this channel is not needed",
          path,
        ),
      );
    }
    channels.push([a, b]);
  }
  return { channels, diagnostics };
};
