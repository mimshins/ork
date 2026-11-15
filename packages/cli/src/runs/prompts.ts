/**
 * @file The prompts a terminal command owns while it follows runs (`ork
 *   attach`, `ork decide --follow`): one prompt per open decision, asked
 *   through a single `TerminalHuman` (which keeps them in order, one at a
 *   time), withdrawn when the decision closes elsewhere, with the "answered
 *   elsewhere" line a person sees then. The command feeds it each decision to
 *   ask and each event seen.
 */

import type { EventStore, RunEvent } from "@krapht/ork-core";

import type { TerminalHuman } from "../human.ts";
import { ANSWERED_BY } from "../run/format.ts";
import { styler } from "../run/view.ts";
import type { Term } from "../term/mode.ts";
import { paint } from "../term/theme.ts";
import { askStored } from "./ask-stored.ts";
import { callPathOf, printUnder } from "./gutter.ts";

/** The event that closes a decision. */
export type DecisionClosed = Extract<
  RunEvent,
  { type: "decision.answered" | "decision.withdrawn" }
>;

/** A prompt in flight, and the event that closed its decision elsewhere. */
type Prompt = {
  controller: AbortController;
  closed?: DecisionClosed;
};

export type PromptsOptions = {
  /** Who answered, as stored (default `terminal`; `decide` for `ork decide`). */
  by?: "decide" | "terminal";
  /** `~`, for the runs' sockets; tests pass a folder. */
  home?: string;
  /** Prints a line of what happened to a prompt, under the run's gutter. */
  out: (line: string) => void;
  /** How lines are drawn. */
  term: Term;
};

/**
 * Where a decision sits: its run and workflow, and the call path of a called
 * run.
 */
export type PromptPlace = {
  run: string;
  path?: readonly string[];
  workflow?: string;
};

export type Prompts = {
  /** Starts asking `decision` (queued behind the prompts before it). */
  ask: (place: PromptPlace, decision: string) => void;
  /** Whether `decision` is being asked or has been asked here. */
  has: (decision: string) => boolean;
  /**
   * Handles an event the caller saw: closes the prompt of a decision answered
   * or withdrawn elsewhere (printing the line) and says `true`, so the caller
   * prints nothing of its own; a decision answered here says `true` too (its
   * card is the line). Any other event says `false`.
   */
  seen: (event: RunEvent) => boolean;
  /** Prompts in flight now. */
  open: () => number;
  /** Aborts every prompt in flight (following is over). */
  abort: () => void;
  /**
   * Resolves when every prompt has settled; throws the first unexpected
   * failure.
   */
  settled: () => Promise<void>;
};

const closedLine = (id: string, closed: DecisionClosed): string => {
  if (closed.type === "decision.withdrawn") return `${id} withdrawn`;
  const by =
    closed.by === "owner"
      ? (closed.owner ?? ANSWERED_BY.owner)
      : ANSWERED_BY[closed.by];
  return `${id} answered elsewhere: ${closed.answer} (${by})`;
};

/** Creates the prompts a command owns over `store`, asked on `human`. */
export const createPrompts = (
  store: EventStore,
  human: TerminalHuman,
  options: PromptsOptions,
): Prompts => {
  const { term, out } = options;
  const say = styler(term);
  const prompts = new Map<string, Prompt>();
  /** Decisions answered here: their `decision.answered` line is the card's. */
  const mine = new Set<string>();
  const asks: Promise<void>[] = [];
  /**
   * The last prompt's settling: the next waits for it, so a withdrawn card's
   * line is printed before the next card.
   */
  let last: Promise<void> = Promise.resolve();
  // Changed from callbacks, so not narrowed by the checks below.
  const state: { failure?: { error: unknown } } = {};

  const show = (path: readonly string[], lines: readonly string[]): void => {
    printUnder(out, term, path, lines);
  };

  const ask: Prompts["ask"] = ({ run, path = [], workflow }, id) => {
    const decision = store.decision(id);
    if (decision === undefined) return;
    const prompt: Prompt = { controller: new AbortController() };
    prompts.set(id, prompt);
    const previous = last;
    const settle = async (): Promise<void> => {
      await previous;
      try {
        const asked = await askStored(store, human, decision, {
          by: options.by ?? "terminal",
          signal: prompt.controller.signal,
          place: {
            run,
            decision: id,
            ...(workflow === undefined ? {} : { workflow }),
            ...(path.length === 0 ? {} : { path: callPathOf(path) }),
          },
          ...(options.home === undefined ? {} : { home: options.home }),
        });
        prompts.delete(id);
        const { closed } = prompt;
        if (asked.kind === "answered") {
          mine.add(id);
          if (!term.rich)
            show(path, [`${say("green", "✓")} ${id}: ${asked.choice}`]);
        } else if (asked.kind === "refused") {
          show(path, [paint(term, "warn", `! ${asked.message}`)]);
        } else if (asked.kind === "withdrawn" && closed !== undefined) {
          show(path, [say("dim", closedLine(id, closed))]);
        }
      } catch (error) {
        prompts.delete(id);
        state.failure ??= { error };
      }
    };
    last = settle();
    asks.push(last);
  };

  return {
    ask,
    has: id => prompts.has(id) || mine.has(id),
    seen: event => {
      if (
        event.type !== "decision.answered" &&
        event.type !== "decision.withdrawn"
      ) {
        return false;
      }
      const prompt = prompts.get(event.decision);
      if (prompt !== undefined) {
        prompt.closed = event;
        prompt.controller.abort();
        return true;
      }
      return event.type === "decision.answered" && mine.has(event.decision);
    },
    open: () => prompts.size,
    abort: () => {
      for (const prompt of prompts.values()) prompt.controller.abort();
    },
    settled: async () => {
      await Promise.all(asks);
      if (state.failure !== undefined) throw state.failure.error;
    },
  };
};
