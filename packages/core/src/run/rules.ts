/**
 * @file Firing a finished node's `notify:` rules (RFC-005). A rule sends
 *   through the bus and starts no session: a node that is not running finds the
 *   message when it next starts. Only a fresh result fires one, so a result a
 *   resumed run hands back does not send its messages again, and a node a
 *   stopping run cut off fires nothing: it has not failed, and runs again on
 *   resume.
 */

import { isToolNode, type Node } from "@krapht/ork-schema";

import {
  evaluate,
  renderTemplate,
  type Scope,
  truthy,
} from "../expr/evaluate.ts";
import type { CompiledGraph } from "../graph/types.ts";
import { maskSecrets } from "../store/mask.ts";
import { clipMessage } from "./bus-text.ts";
import type { Activation, NodeResult } from "./handle.ts";

const lastLine = (text: unknown): string =>
  typeof text === "string" ? (text.trim().split("\n").at(-1) ?? "") : "";

/** Why a node failed, without the id an error may already start with. */
const failed = (id: string, why: string): string => {
  const reason = why.startsWith(`${id}: `) ? why.slice(id.length + 2) : why;
  return reason === "" ? `${id} failed` : `${id} failed: ${reason}`;
};

/** A program that ran says how it exited; anything else has its own reason. */
const toolLine = (id: string, result: NodeResult): string => {
  const { output, ok, error } = result;
  const code = output["exitCode"];
  const exited =
    typeof code === "number" &&
    code >= 0 &&
    output["timedOut"] !== true &&
    (ok || code !== 0);
  if (!exited) return ok ? `${id} passed` : failed(id, error ?? "");
  const last = ok ? "" : lastLine(output["stderr"]);
  return `${id} exited ${String(code)}${last === "" ? "" : `: ${last}`}`;
};

/** Ork's own line about a result, when a rule gives no body. */
export const defaultRuleBody = (
  id: string,
  node: Node | undefined,
  result: NodeResult,
): string => {
  const { output, ok } = result;
  if (node !== undefined && isToolNode(node)) return toolLine(id, result);
  const summary = output["summary"];
  const said = typeof summary === "string" ? summary : "";
  if (!ok) return failed(id, result.error ?? said);
  if (node?.type === "human.gate") {
    const choice = String(output["choice"]);
    return output["answeredBy"] === "timeout"
      ? `${id} timed out and took its default: ${choice}`
      : `${id} answered: ${choice}`;
  }
  // It started a run and did not wait, so nothing has passed yet.
  if (node?.type === "workflow.call" && node.wait === "none") {
    return `${id}: ${said}`;
  }
  return said === "" ? `${id} passed` : `${id} passed: ${said}`;
};

export const createRules = ({
  graph,
  send,
  scope,
  stopping,
  scrub,
}: {
  graph: CompiledGraph;
  send: (from: string, to: string, body: string) => void;
  scope: () => Scope;
  /** Aborted when the whole run stops, which cuts its nodes off. */
  stopping: AbortSignal;
  /** Masks what the run was told to; a body can read an input's value. */
  scrub?: ((text: string) => string) | undefined;
}) => ({
  /** `activation` finished with this fresh result; its output is recorded. */
  fire: (activation: Activation, result: NodeResult): void => {
    if (result.limited !== undefined || (stopping.aborted && !result.ok)) {
      return;
    }
    // A fanned node's items fire none; the node fires once, for all of them.
    if (activation.item !== undefined) return;
    const declared = activation.template ?? activation.id;
    for (const rule of graph.rules.get(declared) ?? []) {
      const base = scope();
      const own: Scope = {
        ...base,
        // A failed node may have no output, so a rule can ask about that.
        output: { ...result.output, ok: result.ok, error: result.error },
        // A spawned instance's output is under its own id, not the template's.
        nodes: { ...base.nodes, [declared]: { output: result.output } },
      };
      if (
        rule.condition === undefined ||
        truthy(evaluate(rule.condition, own))
      ) {
        const written =
          rule.body === undefined ? "" : renderTemplate(rule.body, own);
        const body =
          written === ""
            ? defaultRuleBody(
                activation.id,
                graph.nodes.get(declared)?.node,
                result,
              )
            : written;
        // Masked here, not by the store alone, as the inbox takes it as it is.
        const masked = maskSecrets(scrub === undefined ? body : scrub(body));
        send(activation.id, rule.to, clipMessage(masked));
      }
    }
  },
});
