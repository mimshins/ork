/**
 * @file `ork decide --follow`: ask the open decisions of the live runs in scope
 *   on this terminal, then each one a run opens later, one prompt at a time
 *   (specs/cli.md). Runs are followed with core's `followRuns`, so a run
 *   started after this one, and a called run, are found; a decision answered
 *   elsewhere withdraws its prompt. Ctrl-C and `--until-idle` end it; no
 *   decision is closed by either.
 */

import {
  type DecisionRecord,
  type EventStore,
  followRuns,
  type FollowRunsScope,
  pendingDecisions,
} from "@krapht/ork-core";

import { createTerminalHuman, type TerminalIO } from "../human.ts";
import { styler } from "../run/view.ts";
import { termOf } from "../term/mode.ts";
import { createPrompts } from "./prompts.ts";

/** What `ork decide`'s filters chose, as a run scope and as a decision filter. */
export type FollowFilter = {
  project?: string;
  runId?: string;
  workflow?: string;
};

export type FollowDecisionsSession = {
  out: (line: string) => void;
  /** The terminal that answers. */
  terminal: Omit<TerminalIO, "interrupt">;
  /** Ends following when it aborts, as Ctrl-C does. */
  signal?: AbortSignal;
  /** End once no live run is left in scope and no prompt is in flight. */
  untilIdle?: boolean;
  home?: string;
  /** How often to look for new runs (and poll a run with no socket). */
  intervalMs?: number;
};

const scopeOf = ({
  project,
  runId,
  workflow,
}: FollowFilter): FollowRunsScope => ({
  ...(project === undefined ? {} : { project }),
  ...(runId === undefined ? {} : { run: runId }),
  ...(workflow === undefined ? {} : { workflow }),
});

/**
 * Asks `open` (the decisions open now, in the store's order) and then each
 * decision the runs in `filter` open, until `session.signal` aborts or, with
 * `untilIdle`, nothing is live and nothing is being asked. Says why it stopped
 * and returns.
 */
export const followDecisions = async (
  store: EventStore,
  open: readonly DecisionRecord[],
  filter: FollowFilter,
  session: FollowDecisionsSession,
): Promise<"aborted" | "idle"> => {
  const stop = new AbortController();
  session.signal?.addEventListener("abort", () => {
    stop.abort();
  });
  const human = createTerminalHuman({
    ...session.terminal,
    // Ctrl-C at a prompt, which the terminal takes in raw mode.
    interrupt: () => {
      stop.abort();
    },
  });
  const term = termOf(session.terminal.output, session.terminal.env);
  const say = styler(term);
  const prompts = createPrompts(store, human, {
    by: "decide",
    out: session.out,
    term,
    ...(session.home === undefined ? {} : { home: session.home }),
  });
  // Ctrl-C ends the prompt on screen too: it has its own signal, which
  // `followRuns`' signal does not reach once that has returned "idle".
  stop.signal.addEventListener("abort", () => {
    prompts.abort();
  });
  /**
   * Every decision put to the person: one that was left (`q`) isn't asked
   * again.
   */
  const asked = new Set<string>();
  const workflowOf = (run: string): string | undefined =>
    store.lookup(run).find(r => r.id === run)?.workflow;
  const ask = (run: string, decision: string, path?: readonly string[]) => {
    if (asked.has(decision)) return;
    asked.add(decision);
    const workflow = workflowOf(run);
    prompts.ask(
      {
        run,
        ...(workflow === undefined ? {} : { workflow }),
        ...(path === undefined ? {} : { path }),
      },
      decision,
    );
  };

  try {
    for (const d of open) ask(d.runId, d.id);
    let end: "aborted" | "idle";
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- a pass ends before the next starts
      end = await followRuns(
        store,
        scopeOf(filter),
        ({ run, workflow, path, stored }) => {
          const { event } = stored;
          if (prompts.seen(event)) return;
          // The stored events of a run live at start come first: only a
          // decision still open is asked.
          if (
            event.type === "decision.opened" &&
            (filter.runId === undefined || run === filter.runId) &&
            (filter.workflow === undefined || workflow === filter.workflow) &&
            pendingDecisions(store, { runId: run }).some(
              d => d.id === event.decision,
            )
          ) {
            ask(run, event.decision, path);
          }
        },
        {
          untilIdle: session.untilIdle === true,
          ...(session.home === undefined ? {} : { home: session.home }),
          ...(session.intervalMs === undefined
            ? {}
            : { intervalMs: session.intervalMs }),
          signal: stop.signal,
        },
      );
      if (end === "aborted" || prompts.open() === 0) break;
      // Idle, but a question is still on the screen: finish it, then look again.
      // oxlint-disable-next-line no-await-in-loop -- one question at a time
      await prompts.settled();
      if (stop.signal.aborted) {
        end = "aborted";
        break;
      }
    }
    // Following is over: a prompt still open has no one to answer it.
    prompts.abort();
    await prompts.settled();
    if (end === "idle") {
      session.out(say("dim", "no live runs"));
    } else {
      // Also what was asked here and is still open, though its run has ended.
      const left = new Set([
        ...pendingDecisions(store, filter).map(d => d.id),
        ...[...asked].filter(id => store.decision(id)?.status === "open"),
      ]).size;
      session.out(
        say("dim", `stopped following; ${left} decision(s) still open`),
      );
    }
    return end;
  } finally {
    human.close();
  }
};
