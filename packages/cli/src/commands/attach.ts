/**
 * @file `ork attach`: follow a run and the runs it called on this terminal, and
 *   answer their open decisions here (specs/cli.md). Ctrl-C detaches: the run
 *   keeps going and its decisions stay open (specs/run-control.md).
 */

import { type EventStore, findRun } from "@krapht/ork-core";
import { defineCommand } from "citty";

import { createTerminalHuman, type TerminalIO } from "../human.ts";
import { style, write, writeErr } from "../output.ts";
import { attachRun } from "../runs/attach.ts";
import { withStore } from "../store.ts";
import { attachRefusal } from "./in-a-run.ts";

export type AttachSession = {
  out: (line: string) => void;
  /** The terminal that answers; none (or not interactive) means follow only. */
  terminal?: Omit<TerminalIO, "interrupt">;
  /** Detaches when it aborts, as Ctrl-C does. */
  signal?: AbortSignal;
  home?: string;
  intervalMs?: number;
};

/**
 * Follows `runId` and what it called until it ends or the person detaches, and
 * returns the exit code: 0 when the run succeeded or they detached, else 1.
 */
export const attachSession = async (
  store: EventStore,
  runId: string,
  session: AttachSession,
): Promise<0 | 1> => {
  const detach = new AbortController();
  session.signal?.addEventListener("abort", () => {
    detach.abort();
  });
  const interactive = session.terminal?.interactive === true;
  const human =
    session.terminal === undefined || !interactive
      ? undefined
      : createTerminalHuman({
          ...session.terminal,
          // Ctrl-C at a prompt, which the terminal takes in raw mode.
          interrupt: () => {
            detach.abort();
          },
        });
  try {
    const attached = await attachRun(store, runId, session.out, {
      signal: detach.signal,
      hintNoTerminal: human === undefined,
      ...(human === undefined ? {} : { human }),
      ...(session.home === undefined ? {} : { home: session.home }),
      ...(session.intervalMs === undefined
        ? {}
        : { intervalMs: session.intervalMs }),
    });
    if (detach.signal.aborted) {
      session.out(
        style(
          "dim",
          `detached; run ${runId} keeps going · ork attach ${runId} · ork stop ${runId}`,
        ),
      );
      return 0;
    }
    return attached.exitCode;
  } finally {
    human?.close();
  }
};

export const attach = defineCommand({
  meta: {
    name: "attach",
    description:
      "Follow a run and the runs it called, and answer their questions here; Ctrl-C detaches",
  },
  args: {
    run: {
      type: "positional",
      description: "A run id or a prefix of one",
      required: true,
    },
  },
  run: ({ args }) =>
    withStore(async store => {
      const refusal = process.stdin.isTTY ? attachRefusal() : null;
      if (refusal !== null) {
        writeErr(refusal);
        process.exitCode = 1;
        return;
      }
      const found = findRun(store, args.run, process.cwd());
      if (!found.ok) {
        writeErr(found.error);
        process.exitCode = 1;
        return;
      }
      const abort = new AbortController();
      const onSigint = () => {
        abort.abort();
      };
      process.once("SIGINT", onSigint);
      try {
        process.exitCode = await attachSession(store, found.run.id, {
          out: write,
          signal: abort.signal,
          terminal: {
            input: process.stdin,
            output: process.stdout,
            interactive: process.stdin.isTTY,
          },
        });
      } finally {
        process.off("SIGINT", onSigint);
      }
    }),
});
