/**
 * @file Asks one stored decision on a terminal and stores the answer: the
 *   shared step of `ork decide`'s prompts and of `ork attach` (specs/cli.md).
 *   The question goes through the `TerminalHuman`, so prompts keep their order;
 *   a `signal` withdraws the prompt when the decision closes elsewhere; the
 *   answer goes through `answerDecision`, whose first answer wins.
 */

import {
  answerDecision,
  type DecisionRecord,
  type EventStore,
  type HumanQuestion,
} from "@krapht/ork-core";

import type { AskPlace, TerminalHuman } from "../human.ts";

/** What asking one decision came to. */
export type Asked =
  /** The choice is stored and the run woken. */
  | { kind: "answered"; choice: string }
  /** The person pressed `q`: the decision stays open. */
  | { kind: "later" }
  /** The signal aborted the prompt (answered or withdrawn elsewhere). */
  | { kind: "withdrawn" }
  /** The choice was not stored; `message` is `answerDecision`'s. */
  | { kind: "refused"; message: string };

export type AskStoredOptions = {
  /** Where the card says the question sits. */
  place: AskPlace;
  /** Who answered, as stored: `decide` for `ork decide`, `terminal` for attach. */
  by: "decide" | "terminal";
  /** Withdraws the prompt when aborted. */
  signal?: AbortSignal;
  /** `~`, where the sockets are (tests pass a folder). */
  home?: string;
};

/** Asks `decision` on `human`, then stores the answer unless it was withdrawn. */
export const askStored = async (
  store: EventStore,
  human: TerminalHuman,
  decision: DecisionRecord,
  { place, by, signal, home }: AskStoredOptions,
): Promise<Asked> => {
  let note: string | undefined;
  const question: HumanQuestion = {
    nodeId: decision.node,
    question: decision.question,
    options: decision.options,
    onNote: given => {
      note = given;
    },
    ...(decision.recommended === undefined
      ? {}
      : { recommended: decision.recommended }),
    ...(decision.context === undefined ? {} : { context: decision.context }),
    ...(decision.document === undefined ? {} : { document: decision.document }),
    ...(signal === undefined ? {} : { signal }),
  };
  let choice: string | null;
  try {
    choice = await human.askAt(question, place);
  } catch (error) {
    // Only a withdrawn prompt is a result; any other failure is the caller's.
    if (signal?.aborted === true) return { kind: "withdrawn" };
    throw error;
  }
  if (choice === null) return { kind: "later" };
  const answered = await answerDecision(
    store,
    decision.id,
    choice,
    home,
    by,
    note,
  );
  return answered.ok
    ? { kind: "answered", choice }
    : { kind: "refused", message: answered.error };
};
