/**
 * @file A foreground caller's terminal shows the runs it calls (ADR-081): each
 *   `call.started` attaches to the called run under its call node, at any
 *   depth, and asks its decisions when a person is at the terminal. Once the
 *   caller has ended, following stops for a called run that still runs; one the
 *   caller stopped gets a moment to end first.
 */

import {
  type EventStore,
  liveStatus,
  type RunEvent,
  type RunStatus,
} from "@krapht/ork-core";

import { attachRun } from "../runs/attach.ts";
import { createView, styler } from "./view.ts";
import type { RunWorkflowOptions } from "./workflow-options.ts";

type Shown = { run: string; stop: AbortController; done: Promise<unknown> };

/** How long a called run the caller stopped is followed while it stops. */
const STOP_GRACE_MS = 5000;

const running = (store: EventStore, id: string): boolean => {
  const [record] = store.lookup(id);
  return record !== undefined && liveStatus(record) === "running";
};

export const showCalls = (
  options: Pick<
    RunWorkflowOptions,
    "store" | "out" | "err" | "json" | "showCalls"
  > & { home?: string | undefined },
) => {
  const { store, showCalls: show } = options;
  const shown: Shown[] = [];
  return {
    /** Attaches to the run a `call.started` of the caller names. */
    onEvent: (event: RunEvent): void => {
      if (event.type !== "call.started" || show === undefined || options.json)
        return;
      const stop = new AbortController();
      const done = attachRun(store, event.run, options.out, {
        basePath: [event.node],
        signal: stop.signal,
        // No one at the terminal: the caller's own questions fall back as
        // always, but a called run's wait for `ork decide`.
        ...(show.ask === undefined
          ? { hintNoTerminal: true }
          : { human: show.ask }),
        ...(options.home === undefined ? {} : { home: options.home }),
      }).catch((error: unknown) => {
        options.err(
          `run ${event.run} could not be shown here: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      shown.push({ run: event.run, stop, done });
    },
    /**
     * The caller has ended `status`: stops following the called runs still
     * running, at once, or after a moment when the caller stopped them, and
     * names those that still run.
     */
    end: async (status: RunStatus): Promise<void> => {
      const stopped = status === "interrupted" || status === "timed_out";
      const timers = shown
        .filter(({ run }) => running(store, run))
        .map(({ stop }) =>
          setTimeout(
            () => {
              stop.abort();
            },
            stopped ? STOP_GRACE_MS : 0,
          ),
        );
      await Promise.all(shown.map(({ done }) => done));
      for (const timer of timers) clearTimeout(timer);
      const say = styler(createView().term);
      for (const { run } of shown.filter(({ run: id }) => running(store, id))) {
        options.out(
          say("dim", `↳ run ${run} still running · ork attach ${run}`),
        );
      }
    },
  };
};
