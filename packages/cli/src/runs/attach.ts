/**
 * @file Following a run and every run it called on a terminal, and answering
 *   their open decisions there (`ork attach`, and a foreground `ork run` that
 *   calls workflows; specs/cli.md, specs/scheduler/calls.md). Each run has its
 *   own log printer behind its call path; a decision opened in any of them is
 *   asked through one `TerminalHuman`, withdrawn when it closes elsewhere.
 */

import {
  type EventStore,
  followRunTree,
  pendingDecisions,
} from "@krapht/ork-core";

import type { TerminalHuman } from "../human.ts";
import { createView, styler, type View } from "../run/view.ts";
import { printerFor, printUnder } from "./gutter.ts";
import type { createLogPrinter } from "./logs.ts";
import { createPrompts } from "./prompts.ts";

export type AttachOptions = {
  /** Asks the open decisions; none given, none is asked (no one is there). */
  human?: TerminalHuman;
  /** Says once, at the first decision it can't ask, to answer with `ork decide`. */
  hintNoTerminal?: boolean;
  /** The call path the root run sits under (a caller's call node). */
  basePath?: readonly string[];
  /** `~`, for the runs' sockets; tests pass a folder. */
  home?: string;
  /** How often to poll a run that has no socket. */
  intervalMs?: number;
  /** Stops following (Ctrl-C): nothing is stopped and no decision is closed. */
  signal?: AbortSignal;
  /** How lines are drawn (default: stdout's), for tests. */
  view?: View;
};

export type Attached = {
  /** The called runs, at any depth, still running when following stopped. */
  stillRunning: string[];
  /** 0: the root succeeded, or following was cut short; 1: it did not. */
  exitCode: 0 | 1;
};

/**
 * Prints the events of `root` and of the runs it called until the root ends or
 * `signal` aborts, and asks each open decision with `options.human`.
 */
export const attachRun = async (
  store: EventStore,
  root: string,
  out: (line: string) => void,
  options: AttachOptions = {},
): Promise<Attached> => {
  const { human, basePath = [] } = options;
  const { term } = options.view ?? createView();
  const say = styler(term);
  const printers = new Map<string, ReturnType<typeof createLogPrinter>>();
  // Changed from callbacks, so not narrowed by the checks below.
  const seen: { hinted: boolean; succeeded: boolean } = {
    hinted: false,
    succeeded: false,
  };

  const show = (path: readonly string[], lines: readonly string[]): void => {
    printUnder(out, term, path, lines);
  };

  const prompts =
    human === undefined
      ? undefined
      : createPrompts(store, human, {
          out,
          term,
          ...(options.home === undefined ? {} : { home: options.home }),
        });

  const { end, stillRunning } = await followRunTree(
    store,
    root,
    ({ run, path: below, stored }) => {
      const path = [...basePath, ...below];
      const { event } = stored;
      if (event.type === "run.finished" && below.length === 0) {
        seen.succeeded = event.result.status === "succeeded";
      }
      if (prompts?.seen(event) === true) return;
      if (
        event.type === "decision.opened" &&
        event.owner === undefined &&
        pendingDecisions(store, { runId: run }).some(
          d => d.id === event.decision,
        )
      ) {
        if (prompts !== undefined) {
          prompts.ask({ run, path }, event.decision);
          return;
        }
        if (options.hintNoTerminal === true && !seen.hinted) {
          seen.hinted = true;
          show(path, [say("dim", "no terminal: answer with ork decide")]);
        }
      }
      let print = printers.get(run);
      if (print === undefined) {
        print = printerFor(term, path);
        printers.set(run, print);
      }
      show(path, print(stored));
    },
    {
      ...(options.home === undefined ? {} : { home: options.home }),
      ...(options.intervalMs === undefined
        ? {}
        : { intervalMs: options.intervalMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );

  // Following is over: a prompt still open has no run to answer.
  prompts?.abort();
  await prompts?.settled();
  if (end === "crashed") {
    show(basePath, [
      say("red", `run ${root} stopped without finishing (its process is gone)`),
    ]);
  }
  for (const id of stillRunning) {
    out(say("dim", `↳ run ${id} still running · ork attach ${id}`));
  }
  return {
    stillRunning,
    exitCode: end === "aborted" || seen.succeeded ? 0 : 1,
  };
};
