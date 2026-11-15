/**
 * @file The prompts a terminal command owns while it follows runs (`ork
 *   attach`, `ork decide --follow`): one prompt per open decision, one card at
 *   a time through a single `TerminalHuman`, withdrawn when the decision closes
 *   elsewhere, with the "answered elsewhere" line a person sees then. Decisions
 *   that arrive while a card is up are held and asked in the order they opened
 *   (the store's order), the line of a card withdrawn elsewhere printing before
 *   the next card. A decision arriving with no card up is asked at once: the
 *   followers deliver events in store order, so it is the earliest opened, up
 *   to one poll late (specs/gaps L384). The command feeds it each decision to
 *   ask and each event seen.
 */

import type { DecisionRecord, EventStore, RunEvent } from "@krapht/ork-core";

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
  /**
   * Holds `decision` and asks it as soon as no card is up: the earliest opened
   * of those held comes first. A decision held, in flight or answered here is
   * not asked again.
   */
  ask: (place: PromptPlace, decision: string) => void;
  /** Whether `decision` is held, being asked, or has been answered here. */
  has: (decision: string) => boolean;
  /**
   * Handles an event the caller saw: closes the prompt of a decision answered
   * or withdrawn elsewhere, or drops it from the held ones (printing the line
   * either way) and says `true`, so the caller prints nothing of its own; a
   * decision answered here says `true` too (its card is the line). Any other
   * event says `false`.
   */
  seen: (event: RunEvent) => boolean;
  /** The card on screen and the decisions held behind it. */
  open: () => number;
  /** Aborts the card on screen and drops the held ones (following is over). */
  abort: () => void;
  /**
   * Resolves when no card is in flight and none is held; throws the first
   * unexpected failure.
   */
  settled: () => Promise<void>;
};

/** The line a person sees when `id` closes elsewhere. */
export const closedLine = (id: string, closed: DecisionClosed): string => {
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
  /** The card on screen (at most one). */
  const prompts = new Map<string, Prompt>();
  /**
   * Decisions waiting for the card on screen to settle. They can arrive in a
   * different order than they opened (specs/gaps L384); held, they are asked in
   * the order they opened.
   */
  const held = new Map<string, PromptPlace>();
  /** Decisions answered here: their `decision.answered` line is the card's. */
  const mine = new Set<string>();
  /** The card in flight, up to the next one's start. */
  let running: Promise<void> | undefined;
  // Changed from callbacks, so not narrowed by the checks below.
  const state: { failure?: { error: unknown }; over?: true } = {};

  const show = (path: readonly string[], lines: readonly string[]): void => {
    printUnder(out, term, path, lines);
  };

  /** Asks `decision` on the card, and says what came of it. */
  const card = async (
    decision: DecisionRecord,
    { run, path = [], workflow }: PromptPlace,
  ): Promise<void> => {
    const { id } = decision;
    const prompt: Prompt = { controller: new AbortController() };
    prompts.set(id, prompt);
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
      // Say so now: the drain stops, and settled() only throws after following ends.
      const message = error instanceof Error ? error.message : String(error);
      show(path, [paint(term, "warn", `! ${id}: ${message}`)]);
    }
  };

  /**
   * Asks the earliest opened of the held decisions, once no card is up; drops a
   * held decision that is no longer open (its close event was not seen). Runs
   * again when the card settles, after the card's own line is printed.
   */
  const drain = (): void => {
    if (running !== undefined || state.over || state.failure !== undefined) {
      return;
    }
    const opened = store.decisions({ status: "open" });
    for (const id of held.keys()) {
      if (!opened.some(d => d.id === id)) held.delete(id);
    }
    const next = opened.find(d => held.has(d.id));
    const place = next === undefined ? undefined : held.get(next.id);
    if (next === undefined || place === undefined) return;
    held.delete(next.id);
    const run = async (): Promise<void> => {
      await card(next, place);
      running = undefined;
      drain();
    };
    running = run();
  };

  return {
    ask: (place, id) => {
      if (state.over || held.has(id) || prompts.has(id) || mine.has(id)) return;
      held.set(id, place);
      drain();
    },
    has: id => prompts.has(id) || held.has(id) || mine.has(id),
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
      const place = held.get(event.decision);
      if (place !== undefined) {
        held.delete(event.decision);
        show(place.path ?? [], [say("dim", closedLine(event.decision, event))]);
        return true;
      }
      return event.type === "decision.answered" && mine.has(event.decision);
    },
    open: () => prompts.size + held.size,
    abort: () => {
      state.over = true;
      held.clear();
      for (const prompt of prompts.values()) prompt.controller.abort();
    },
    settled: async () => {
      // The next card starts when this one settles.
      for (let current = running; current !== undefined; current = running) {
        // oxlint-disable-next-line no-await-in-loop -- one card at a time
        await current;
      }
      if (state.failure !== undefined) throw state.failure.error;
    },
  };
};
