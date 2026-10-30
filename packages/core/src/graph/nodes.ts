import type { DecisionOption, Diagnostic, Workflow } from "@krapht/ork-schema";

import { error, warning } from "./diagnostics.ts";
import type { CompiledEdge } from "./types.ts";

const optionId = (option: DecisionOption) =>
  typeof option === "string" ? option : option.id;

/** Per-type checks that need the rest of the graph. */
export const checkNodes = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const [id, node] of Object.entries(workflow.nodes)) {
    const path = ["nodes", id];
    const incoming = edges.filter(e => e.to === id);
    const outgoing = edges.filter(e => e.from === id);

    if (node.type === "control.join") {
      const sources = new Set(incoming.map(e => e.from)).size;
      if (sources < 2) {
        diagnostics.push(
          warning(
            "join.inputs",
            `join "${id}" has ${sources} incoming node(s); a join waits for two or more`,
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
            `router "${id}" has no edge with a when: condition`,
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
              `${key} "${value}" is not one of the options (${ids.join(", ")})`,
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
          `input "${name}" is required and has a default; the default is never used`,
          ["inputs", name],
        ),
      );
    }
  }

  return diagnostics;
};

/** Declared message channels between nodes that have sessions. */
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
    const bad = [a, b].filter(id => {
      const node = workflow.nodes[id];
      return (
        node === undefined ||
        (node.type !== "claude.leader" && node.type !== "claude.worker")
      );
    });
    if (bad.length > 0) {
      diagnostics.push(
        error(
          "message.endpoint",
          `${bad.map(id => `"${id}"`).join(", ")}: channels connect claude.leader and claude.worker nodes`,
          path,
        ),
      );
      continue;
    }
    const nodeA = workflow.nodes[a];
    const nodeB = workflow.nodes[b];
    if (nodeA?.parent === b || nodeB?.parent === a) {
      diagnostics.push(
        warning(
          "message.implicit",
          "a parent and its child can always message each other; this channel is not needed",
          path,
        ),
      );
    }
    channels.push([a, b]);
  }
  return { channels, diagnostics };
};
