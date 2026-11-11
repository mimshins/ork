/**
 * @file How a session reaches people: questions and permission prompts (the
 *   `HumanChannel`, which a run's decision queue records), and the leader a
 *   node's questions go to first (`questions: owner`, ADR-063).
 */

import type { Driver } from "@krapht/ork-schema";

import type { RuntimeEvent, SessionUsage } from "./types.ts";

export type DecisionChoice = {
  id: string;
  label?: string;
  description?: string;
};

/**
 * Takes the note a person gave with their answer, before the answer resolves;
 * not called when they gave none (specs/messaging.md#decisions).
 */
export type NoteTaker = (note: string) => void;

/** A question as a session asks it (`ask_user`), and as a decision records it. */
export type HumanQuestion = {
  nodeId: string;
  question: string;
  options: DecisionChoice[];
  recommended?: string;
  context?: string;
  /** What to read to answer, apart from the short question; only gates set it. */
  document?: string;
  /**
   * Waits for a person: with no one at the terminal it is not answered there
   * (no recommended choice, no "no one"), and waits for `ork decide` or the UI.
   * Gates set it; an agent's `ask_user` doesn't, so a session never hangs.
   */
  waits?: boolean;
  /** Withdraws the question, e.g. when a gate's timeout answers it. */
  signal?: AbortSignal;
  onNote?: NoteTaker;
  /**
   * The leader that passed the question on to the person, with its note in
   * `context` (`questions: owner`, ADR-063).
   */
  owner?: string;
  /** Called, before the answer resolves, when the asker's owner answered. */
  onOwner?: (owner: string) => void;
};

/**
 * How a session reaches the human: a permission prompt or a question. In a run
 * it is the decision queue, which records each one and takes the first answer
 * from the terminal or `ork decide`.
 */
export type HumanChannel = {
  permit: (request: {
    nodeId: string;
    toolName: string;
    input: Record<string, unknown>;
    /** Withdraws the prompt, e.g. when another terminal answered it. */
    signal?: AbortSignal;
    onNote?: NoteTaker;
  }) => Promise<{ allow: true } | { allow: false; message: string }>;
  ask: (question: HumanQuestion) => Promise<string>;
  /**
   * Records a question its asker's owner answered, as a decision answered by
   * that owner, with the owner's note; absent where nothing records decisions.
   */
  settled?: (
    question: HumanQuestion & { answer: string; owner: string; note?: string },
  ) => void;
};

/**
 * The leader a node's questions go to first (`questions: owner`, ADR-063): a
 * fork of its latest session answers them, or passes them on to the person.
 */
export type OwnerPort = {
  id: string;
  /** Its latest own session, and where and how it ran; none before it starts. */
  session: () =>
    | { sessionId: string; cwd: string; driver?: Driver; model?: string }
    | undefined;
  /** What a fork may spend: what is left of the run's budget now. */
  budgetLeftUsd: () => number | undefined;
  /** Counts a fork's spend in the run's, against the owner. */
  charge: (sessionId: string, usage: SessionUsage) => void;
  /** Records a fork's events as the owner's, marked as a fork. */
  emit: (event: RuntimeEvent) => void;
};
