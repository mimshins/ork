/**
 * @file The `budget.leader` warning: a leader with nodes to delegate to and no
 *   cap of its own under a run budget. Its session sets aside what is left of
 *   the run's budget in that unit, and a leader's reserve is never waited on
 *   (ADR-077), so the nodes it owns are refused. A compiler warning, like
 *   `loop.uncapped`, on the effective workflow: it never stops a run.
 */

import {
  type Diagnostic,
  isClaudeNode,
  type Workflow,
} from "@krapht/ork-schema";

import { warning } from "./diagnostics.ts";

const UNITS = ["budgetUsd", "budgetTokens"] as const;

/** One warning per leader and run budget its own cap leaves open. */
export const leaderBudgetWarnings = (workflow: Workflow): Diagnostic[] =>
  Object.entries(workflow.nodes).flatMap(([id, node]) => {
    if (node.type !== "agent.leader" || !isClaudeNode(node)) return [];
    const owns = Object.values(workflow.nodes).some(
      child =>
        child.parent === id &&
        (child.type === "agent.leader" || child.type === "agent.worker"),
    );
    if (!owns) return [];
    return UNITS.filter(
      unit =>
        workflow.limits?.[unit] !== undefined &&
        (node[unit] ?? workflow.defaults?.[unit]) === undefined,
    ).map(unit =>
      warning(
        "budget.leader",
        `leader \`${id}\` has no ${unit} of its own, so its session sets aside all that is left of limits.${unit} and the nodes it owns are refused; give it a ${unit}, or set one in defaults`,
        ["nodes", id],
      ),
    );
  });
