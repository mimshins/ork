/**
 * @file The compiler's checks on `workflow.call` nodes (RFC-004), and on a
 *   workflow's `outputs`. A call to another file's workflow is checked by `ork
 *   validate`, which can read it; the compiler sees one file.
 */

import type { Diagnostic, Workflow } from "@krapht/ork-schema";

import { error } from "./diagnostics.ts";

export const checkCalls = (workflow: Workflow): Diagnostic[] =>
  Object.entries(workflow.nodes).flatMap(([id, node]) => {
    if (node.type !== "workflow.call") return [];
    const path = ["nodes", id];
    const found: Diagnostic[] = [];
    if (node.parent !== undefined) {
      found.push(
        error(
          "call.parent",
          `call \`${id}\` cannot have an owner: a leader delegates to its own children, not to another run`,
          [...path, "parent"],
        ),
      );
    }
    if (node.wait === "node" && node.node === undefined) {
      found.push(
        error(
          "call.wait-node",
          `call \`${id}\` waits on a node but names none`,
          [...path, "wait"],
        ),
      );
    }
    if (node.project === undefined && node.workflow === workflow.name) {
      found.push(
        error("call.self", `call \`${id}\` calls its own workflow`, [
          ...path,
          "workflow",
        ]),
      );
    }
    const inChannel = (workflow.messages ?? []).some(({ between }) =>
      between.includes(id),
    );
    if (inChannel && workflow.rules?.links === "off") {
      found.push(
        error(
          "call.links-off",
          `call \`${id}\` is in a messages channel, but this workflow's rules turn links off`,
          path,
        ),
      );
    }
    return found;
  });
