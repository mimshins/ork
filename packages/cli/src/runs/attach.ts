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
  type RunEvent,
} from "@krapht/ork-core";

import type { TerminalHuman } from "../human.ts";
import { ANSWERED_BY } from "../run/format.ts";
import { createView, styler } from "../run/view.ts";
import { paint } from "../term/theme.ts";
import { askStored } from "./ask-stored.ts";
import { createLogPrinter } from "./logs.ts";

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
};

export type Attached = {
  /** The called runs, at any depth, still running when following stopped. */
  stillRunning: string[];
  /** 0: the root succeeded, or following was cut short; 1: it did not. */
  exitCode: 0 | 1;
};

const where = (path: readonly string[]): string => path.join(" › ");

/** A prompt in flight, and the event that closed its decision elsewhere. */
type Prompt = {
  controller: AbortController;
  closed?: Extract<
    RunEvent,
    { type: "decision.answered" | "decision.withdrawn" }
  >;
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
  const { term } = createView();
  const say = styler(term);
  const printers = new Map<string, ReturnType<typeof createLogPrinter>>();
  const prompts = new Map<string, Prompt>();
  /** Decisions answered here: their `decision.answered` line is the card's. */
  const mine = new Set<string>();
  const asks: Promise<void>[] = [];
  // Changed from callbacks, so not narrowed by the checks below.
  const seen: {
    failure?: { error: unknown };
    hinted: boolean;
    succeeded: boolean;
  } = { hinted: false, succeeded: false };

  const show = (path: readonly string[], lines: readonly string[]): void => {
    const prefix =
      path.length === 0 ? "" : paint(term, "muted", `${where(path)} › `);
    for (const line of lines) out(line === "" ? line : `${prefix}${line}`);
  };

  const ask = (run: string, path: readonly string[], id: string): void => {
    const decision = store.decision(id);
    if (human === undefined || decision === undefined) return;
    const prompt: Prompt = { controller: new AbortController() };
    prompts.set(id, prompt);
    const settle = async (): Promise<void> => {
      try {
        const asked = await askStored(store, human, decision, {
          by: "terminal",
          signal: prompt.controller.signal,
          place: {
            run,
            decision: id,
            ...(path.length === 0 ? {} : { path: where(path) }),
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
          const by =
            closed.type === "decision.answered"
              ? closed.by === "owner"
                ? (closed.owner ?? ANSWERED_BY.owner)
                : ANSWERED_BY[closed.by]
              : "";
          show(path, [
            say(
              "dim",
              closed.type === "decision.answered"
                ? `${id} answered elsewhere: ${closed.answer} (${by})`
                : `${id} withdrawn`,
            ),
          ]);
        }
      } catch (error) {
        prompts.delete(id);
        seen.failure ??= { error };
      }
    };
    asks.push(settle());
  };

  const { end, stillRunning } = await followRunTree(
    store,
    root,
    ({ run, path: below, stored }) => {
      const path = [...basePath, ...below];
      const { event } = stored;
      if (event.type === "run.finished" && below.length === 0) {
        seen.succeeded = event.result.status === "succeeded";
      }
      if (
        event.type === "decision.answered" ||
        event.type === "decision.withdrawn"
      ) {
        const prompt = prompts.get(event.decision);
        if (prompt !== undefined) {
          prompt.closed = event;
          prompt.controller.abort();
          return;
        }
        if (event.type === "decision.answered" && mine.has(event.decision))
          return;
      }
      if (
        event.type === "decision.opened" &&
        event.owner === undefined &&
        pendingDecisions(store, { runId: run }).some(
          d => d.id === event.decision,
        )
      ) {
        if (human !== undefined) {
          ask(run, path, event.decision);
          return;
        }
        if (options.hintNoTerminal === true && !seen.hinted) {
          seen.hinted = true;
          show(path, [say("dim", "no terminal: answer with ork decide")]);
        }
      }
      let print = printers.get(run);
      if (print === undefined) {
        print = createLogPrinter({ json: false });
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
  for (const prompt of prompts.values()) prompt.controller.abort();
  await Promise.all(asks);
  if (seen.failure !== undefined) throw seen.failure.error;
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
