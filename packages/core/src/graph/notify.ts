/**
 * @file Compiling `notify:` rules (RFC-005): a message a workflow declares on a
 *   node, sent when it finishes. A rule goes to a leader or a worker, the only
 *   nodes with a session to read it, and its condition and body are parsed
 *   here, so the scheduler only ever evaluates them. The references they make
 *   are checked with the others (`refs.ts`).
 */

import type { Diagnostic, Workflow } from "@krapht/ork-schema";

import { parseTemplate, type TemplatePart } from "../expr/evaluate.ts";
import { type Expr, parseExpr } from "../expr/parse.ts";
import { error, warning } from "./diagnostics.ts";
import { forEachOf, outputFieldsOf } from "./types.ts";

export type CompiledRule = {
  to: string;
  /** The rule fires only when this holds; none means every finish. */
  condition?: Expr;
  /** The message; none means Ork's own line about the result. */
  body?: TemplatePart[];
  /** Its source, for the reference checks. */
  bodySource?: string;
};

const RECEIVERS = new Set(["claude.leader", "claude.worker"]);

export const compileRules = (
  workflow: Workflow,
): { rules: Map<string, CompiledRule[]>; diagnostics: Diagnostic[] } => {
  const rules = new Map<string, CompiledRule[]>();
  const diagnostics: Diagnostic[] = [];
  for (const [id, node] of Object.entries(workflow.nodes)) {
    const declared = "notify" in node ? (node.notify ?? []) : [];
    const compiled: CompiledRule[] = [];
    const hidden = (outputFieldsOf(node) ?? []).filter(
      field => field === "ok" || field === "error",
    );
    for (const [index, rule] of declared.entries()) {
      const path = ["nodes", id, "notify", index];
      if (
        hidden.length > 0 &&
        (rule.when !== undefined || rule.body !== undefined)
      ) {
        diagnostics.push(
          warning(
            "notify.shadowed",
            `in a rule, ${hidden.join(" and ")} mean how the node ended, not its field; read that as nodes.${id}.output.${hidden[0] ?? ""}`,
            path,
          ),
        );
      }
      const target = workflow.nodes[rule.to];
      if (rule.to === id) {
        diagnostics.push(
          error("notify.self", "a node cannot notify itself", [...path, "to"]),
        );
      } else if (target === undefined || !RECEIVERS.has(target.type)) {
        diagnostics.push(
          error(
            "notify.target",
            `\`${rule.to}\`: a rule goes to a \`claude.leader\` or \`claude.worker\`, which has a session to read it`,
            [...path, "to"],
          ),
        );
      }
      if (target !== undefined && forEachOf(target) !== undefined) {
        diagnostics.push(
          error(
            "forEach.notify",
            `\`${rule.to}\` has \`forEach\`: a rule goes to one session, and its items don't exist until its list is resolved.`,
            [...path, "to"],
          ),
        );
      }
      const entry: CompiledRule = { to: rule.to };
      if (rule.when !== undefined) {
        const parsed = parseExpr(rule.when);
        if (parsed.ok) entry.condition = parsed.expr;
        else {
          diagnostics.push(
            error(
              "notify.when-syntax",
              `\`when:\` ${parsed.message} at column ${String(parsed.offset + 1)}`,
              [...path, "when"],
            ),
          );
        }
      }
      if (rule.body !== undefined) {
        const parsed = parseTemplate(rule.body);
        if (parsed.ok) {
          entry.body = parsed.parts;
          entry.bodySource = rule.body;
        } else {
          diagnostics.push(
            error("template.syntax", parsed.message, [...path, "body"]),
          );
        }
      }
      compiled.push(entry);
    }
    if (compiled.length > 0) rules.set(id, compiled);
  }
  return { rules, diagnostics };
};
