/**
 * @file The questions the bus asks a live owner about a node it owns, such as a
 *   loop out of rounds, before anyone asks the human. A session that ends with
 *   one open hands it back unanswered.
 */

import type { DecisionChoice } from "../runtime/types.ts";
import type { OwnerQuestion } from "./bus-events.ts";
import { ownerQuestionText } from "./bus-text.ts";
import type { RunEvent } from "./types.ts";

type Open = {
  owner: string;
  options: DecisionChoice[];
  resolve: (answer: string | null) => void;
};

export const createOwnerQuestions = ({
  ownerOf,
  deliverTo,
  onEvent,
}: {
  ownerOf: (node: string) => string | undefined;
  /** How to reach a live session; `undefined` when it is not live. */
  deliverTo: (node: string) => ((text: string) => void) | undefined;
  onEvent: (event: RunEvent) => void;
}) => {
  const open = new Map<string, Open>();
  let questions = 0;
  return {
    ask: (node: string, question: OwnerQuestion): Promise<string | null> => {
      const owner = ownerOf(node);
      const deliver = owner === undefined ? undefined : deliverTo(owner);
      if (owner === undefined || deliver === undefined) {
        return Promise.resolve(null);
      }
      questions += 1;
      const id = `q${String(questions)}`;
      const { promise, resolve } = Promise.withResolvers<string | null>();
      open.set(id, { owner, options: question.options, resolve });
      const asked: RunEvent = {
        type: "owner.asked",
        node: owner,
        about: node,
        question: id,
        text: question.question,
        options: question.options,
      };
      if (question.recommended !== undefined) {
        asked.recommended = question.recommended;
      }
      onEvent(asked);
      deliver(ownerQuestionText(id, node, question));
      return promise;
    },
    answer: (
      id: string,
      question: string,
      choice: string,
    ): { ok: true } | { ok: false; error: string } => {
      const asked = open.get(question);
      if (asked?.owner !== id) {
        return { ok: false, error: `no open question ${question} for you` };
      }
      if (!asked.options.some(o => o.id === choice)) {
        return {
          ok: false,
          error: `\`${choice}\` is not an option: ${asked.options.map(o => o.id).join(", ")}`,
        };
      }
      open.delete(question);
      onEvent({ type: "owner.answered", node: id, question, answer: choice });
      asked.resolve(choice);
      return { ok: true };
    },
    /** `id`'s session ended: what it was asked goes back unanswered. */
    ended: (id: string): void => {
      for (const [question, asked] of open) {
        if (asked.owner !== id) continue;
        open.delete(question);
        onEvent({ type: "owner.unanswered", node: id, question });
        asked.resolve(null);
      }
    },
  };
};
