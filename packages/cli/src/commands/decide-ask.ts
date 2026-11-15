/**
 * @file `ork decide` answering on a terminal: the open decisions one at a time
 *   (`askOpen`), or those and every one a live run opens later (`--follow`,
 *   `followCommand`), with the line a plain terminal gets after an answer.
 */

import {
  type DecisionRecord,
  type EventStore,
  openStore,
} from "@krapht/ork-core";

import type { TerminalHuman } from "../human.ts";
import { fail } from "../list/flags.ts";
import { style, write } from "../output.ts";
import { askStored } from "../runs/ask-stored.ts";
import { followDecisions } from "../runs/follow-decisions.ts";
import { canKey } from "../term/mode.ts";
import { selectDecisions } from "./decide-list.ts";
import { decideRefusal } from "./in-a-run.ts";

/** What the answer said, as stored (masked), after the answer's line. */
export const saidLine = (store: EventStore, id: string): string => {
  const note = store.decision(id)?.note;
  return note === undefined ? "" : style("dim", ` · said: ${note}`);
};

/** The workflow a card names for a run, when the store knows it. */
const workflowOf = (store: EventStore, run: string): { workflow?: string } => {
  const workflow = store.lookup(run).find(r => r.id === run)?.workflow;
  return workflow === undefined ? {} : { workflow };
};

/** Asks `open` on `human`, one question at a time, in order. */
export const askOpen = async (
  store: EventStore,
  human: TerminalHuman,
  open: readonly DecisionRecord[],
): Promise<void> => {
  // A card collapses to the line that says what was chosen; only plain
  // output needs the answer's line as well.
  const collapses = canKey(process.stdin, process.stdout);
  for (const [index, d] of open.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- one question at a time
    const asked = await askStored(store, human, d, {
      by: "decide",
      place: {
        run: d.runId,
        ...workflowOf(store, d.runId),
        decision: d.id,
        index: index + 1,
        total: open.length,
      },
    });
    if (asked.kind === "refused")
      write(`${style("yellow", "!")} ${asked.message}\n`);
    else if (asked.kind === "answered" && !collapses) {
      write(
        `${style("green", "✓")} ${d.id}: ${asked.choice}${saidLine(store, d.id)}\n`,
      );
    }
  }
};

/** `ork decide --follow`: the person at this terminal answers as decisions open. */
export const followCommand = async (
  args: Readonly<Record<string, unknown>>,
): Promise<void> => {
  const refusal = decideRefusal();
  if (refusal !== null) {
    fail(refusal);
    return;
  }
  if (!process.stdin.isTTY) {
    fail(
      "--follow needs a terminal to answer on; `ork decide --list` shows what is open.",
    );
    return;
  }
  const store = openStore();
  const stop = new AbortController();
  const onSigint = () => {
    stop.abort();
  };
  try {
    const selected = selectDecisions(store, args);
    if (selected === undefined) return;
    process.once("SIGINT", onSigint);
    await followDecisions(store, selected.open, selected.filter, {
      out: write,
      signal: stop.signal,
      untilIdle: args["until-idle"] === true,
      terminal: {
        input: process.stdin,
        output: process.stdout,
        interactive: true,
        verbose: args["verbose"] === true,
      },
    });
  } finally {
    process.off("SIGINT", onSigint);
    store.close();
  }
};
