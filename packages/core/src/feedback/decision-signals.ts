/**
 * @file The system signals an answered decision gives (specs/feedback.md): a
 *   permission the user denied (`permission.denied`), an answer other than the
 *   recommended one (`recommendation.overridden`), and a shell rule people keep
 *   allowing across the project's runs, proposed for its rules file
 *   (`permission.suggest`, RFC-028; the file is not written).
 */

import type { DecisionRecord } from "../store/types.ts";
import type { Signal } from "./end-signals.ts";
import {
  COUNTED_ALLOWS,
  offeredRules,
  suggestedRules,
} from "./permission-suggest.ts";

/** A decision as the run's `decision.opened` event asked it. */
export type Asked = {
  node: string;
  kind: "question" | "permission";
  question: string;
  recommended?: string;
};

/** The project's permission history `permission.suggest` reads. */
export type PermissionHistory = {
  /** The project's answered decisions, every run's; read on each allow. */
  decisions: () => readonly DecisionRecord[];
  /** The project's `permissions.allow`. */
  allow: readonly string[];
  /** The rules file a proposed rule goes in. */
  file: string;
};

/** What answering `question` with `answer` signals, and the node it is about. */
export const answeredSignal = (
  question: Asked,
  answer: string,
): [string, Signal] | null => {
  if (question.kind === "permission") {
    if (answer !== "deny") return null;
    const tool = question.question.replace(/^Allow /u, "").replace(/\?$/u, "");
    return [
      question.node,
      {
        code: "permission.denied",
        kind: "friction",
        target: "workflow",
        severity: "low",
        title: `${question.node} was denied ${tool}`,
        body: "Allow it in the node's `tools.allow` if it needs it, or tell it in its prompt not to use it.",
        evidence: [tool],
      },
    ];
  }
  if (question.recommended === undefined || answer === question.recommended) {
    return null;
  }
  return [
    question.node,
    {
      code: "recommendation.overridden",
      kind: "context-gap",
      target: "workflow",
      severity: "low",
      title: `The answer to ${question.node}'s question was not the one it recommended`,
      body: `Asked: ${question.question} Recommended: ${question.recommended}. Answered: ${answer}.`,
    },
  ];
};

/**
 * The rules the permission decision `id`, allowed with `answer`, tips over the
 * project's thresholds: one signal each, titled by its rule so each rule has
 * its own fingerprint.
 */
export const suggestionSignals = (
  history: PermissionHistory | undefined,
  question: Asked | undefined,
  id: string,
  answer: string,
): Signal[] => {
  if (
    history === undefined ||
    question?.kind !== "permission" ||
    !COUNTED_ALLOWS.has(answer)
  ) {
    return [];
  }
  const decisions = history.decisions();
  const current = decisions.find(each => each.id === id);
  if (current === undefined) return [];
  const due = new Set(suggestedRules(decisions, history.allow));
  return offeredRules(current)
    .filter(rule => due.has(rule))
    .map(rule => ({
      code: "permission.suggest",
      kind: "friction",
      target: "project",
      severity: "low",
      title: `Allow ${rule} in the project's rules`,
      body: `People keep allowing \`${rule}\` when a node asks. If every node of the project may run it, add it to \`permissions.allow\` in ${history.file}.`,
      evidence: [rule, history.file],
    }));
};
