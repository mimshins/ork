/**
 * @file The events of a run's decisions: a question or permission prompt
 *   opened, answered (by whom, with what note), or withdrawn. A child's
 *   question its leader took first (ADR-063) names that leader as `owner`.
 */

import type { DecisionChoice } from "../runtime/types.ts";
import type { AnsweredBy, DecisionKind } from "../store/types.ts";

export type DecisionEvent =
  | {
      type: "decision.opened";
      node: string;
      decision: string;
      kind: DecisionKind;
      question: string;
      options: DecisionChoice[];
      recommended?: string;
      /** The leader that passed it on, or answered it (ADR-063). */
      owner?: string;
    }
  | {
      type: "decision.answered";
      node: string;
      decision: string;
      answer: string;
      by: AnsweredBy;
      /** What the person said with it, when they said something. */
      note?: string;
      /** The leader that answered (`by: owner`) or passed it on. */
      owner?: string;
    }
  | { type: "decision.withdrawn"; node: string; decision: string };
