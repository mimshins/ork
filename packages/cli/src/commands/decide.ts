/**
 * @file `ork decide`: answer a live run's open decisions from any terminal (it
 *   writes to the store, then wakes the run on its socket; specs/messaging.md).
 *   `--say` gives the answer a note, which goes to the run with it. With `--id`
 *   and `--choose`, `--note` and `--rating` instead note how the decision's
 *   node went, as the run's feedback (specs/feedback.md). `--document` prints
 *   what a gate gave to read beside its question.
 */

import {
  answerDecision,
  checkNote,
  decisionListTable,
  type EventStore,
  type Noted,
  openStore,
  recordNote,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { createTerminalHuman } from "../human.ts";
import { allAlias } from "../list/all-alias.ts";
import { filterArgs } from "../list/flags.ts";
import { style, write, writeErr } from "../output.ts";
import { askStored } from "../runs/ask-stored.ts";
import { canKey } from "../term/mode.ts";
import { asksForList, printDecisions, selectDecisions } from "./decide-list.ts";
import { decideRefusal } from "./in-a-run.ts";

const failed = (message: string): void => {
  writeErr(message);
  process.exitCode = 1;
};

/**
 * Notes the answered decision's node, when there's a note or a rating; a rating
 * alone is its note's words.
 */
export const noteDecision = (
  store: EventStore,
  id: string,
  note?: string,
  rating?: string,
): Noted | undefined => {
  if (note === undefined && rating === undefined) return undefined;
  const decision = store.decision(id);
  const [run] = decision === undefined ? [] : store.lookup(decision.runId);
  if (decision === undefined || run === undefined) {
    return { ok: false, error: `No decision ${id} to note.` };
  }
  return recordNote(
    store,
    run,
    {
      text: note ?? `Rated ${rating ?? ""} at ${decision.question}`,
      node: decision.node,
      rating,
    },
    "--",
  );
};

/** Why a note given with an answer can't be recorded, before answering. */
export const noteProblem = (
  note?: string,
  rating?: string,
): string | undefined => {
  if (note === undefined && rating === undefined) return undefined;
  const checked = checkNote({ text: note ?? "rated", rating }, "--");
  return checked.ok ? undefined : checked.error;
};

/** What the answer said, as stored (masked), after the answer's line. */
export const saidLine = (store: EventStore, id: string): string => {
  const note = store.decision(id)?.note;
  return note === undefined ? "" : style("dim", ` · said: ${note}`);
};

export const decide = defineCommand({
  meta: {
    name: "decide",
    description: "Answer the open decisions of this project's live runs",
  },
  args: {
    // Not `run`: a positional of that name would clear the `--run` flag.
    "run-id": {
      type: "positional",
      description: "Only this run's decisions (an id or a prefix)",
      required: false,
    },
    ...filterArgs(decisionListTable, {
      extra: {
        ...allAlias,
        list: {
          type: "boolean",
          description: "List them without answering",
          default: false,
        },
      },
    }),
    document: {
      type: "boolean",
      description: "Print the document of the decision --id names",
      default: false,
    },
    id: { type: "string", description: "Answer this decision…" },
    choose: { type: "string", description: "…with this option" },
    say: {
      type: "string",
      description:
        "…and say this with it: the answer's note, which goes to the run",
    },
    note: {
      type: "string",
      description:
        "…and note how its node went; the note joins the run's feedback",
    },
    rating: { type: "string", description: "…rating it good or bad" },
    verbose: {
      type: "boolean",
      description: "Show each question's whole context, not its first lines",
      default: false,
    },
  },
  run: async ({ args }) => {
    // Any flag that shapes a list means listing, so a terminal never starts
    // answering by accident.
    const listing = asksForList(args);
    const answers =
      !args.document &&
      (args.id !== undefined ||
        args.choose !== undefined ||
        (process.stdin.isTTY && !listing));
    const refusal = answers ? decideRefusal() : null;
    if (refusal !== null) {
      failed(refusal);
      return;
    }
    const store = openStore();
    const human = createTerminalHuman({
      input: process.stdin,
      output: process.stdout,
      interactive: process.stdin.isTTY,
      verbose: args.verbose,
    });
    try {
      if (args.document) {
        if (args.id === undefined || args.choose !== undefined) {
          failed("--document goes with --id, without --choose.");
          return;
        }
        const { document } = store.decision(args.id) ?? {};
        if (document === undefined) failed(`${args.id} has no document.`);
        else write(document);
        return;
      }
      if (args.id !== undefined || args.choose !== undefined) {
        if (args.id === undefined || args.choose === undefined) {
          failed("--id and --choose go together.");
          return;
        }
        // A bad note is said before the answer, which can't be taken back.
        const problem = noteProblem(args.note, args.rating);
        if (problem !== undefined) {
          failed(problem);
          return;
        }
        const answered = await answerDecision(
          store,
          args.id,
          args.choose,
          undefined,
          "decide",
          args.say,
        );
        if (!answered.ok) {
          failed(answered.error);
          return;
        }
        write(
          `${style("green", "✓")} ${args.id}: ${args.choose}${saidLine(store, args.id)}`,
        );
        const noted = noteDecision(store, args.id, args.note, args.rating);
        if (noted === undefined) return;
        if (noted.ok)
          write(`${style("green", "✓")} noted in item ${noted.item}`);
        else failed(noted.error);
        return;
      }
      if (args.note !== undefined || args.rating !== undefined) {
        failed("--note and --rating go with --id and --choose.");
        return;
      }
      if (args.say !== undefined) {
        failed(
          "--say goes with --id and --choose; answering here, press n to add a note (plain: it asks for one after each choice).",
        );
        return;
      }
      const selected = selectDecisions(store, args);
      if (selected === undefined) return;
      const { open, workflow } = selected;
      if (asksForList(args) || !process.stdin.isTTY || open.length === 0) {
        printDecisions(open, args, workflow);
        return;
      }
      // A card collapses to the line that says what was chosen; only plain
      // output needs the answer's line as well.
      const collapses = canKey(process.stdin, process.stdout);
      for (const [index, d] of open.entries()) {
        // oxlint-disable-next-line no-await-in-loop -- one question at a time
        const asked = await askStored(store, human, d, {
          by: "decide",
          place: {
            run: d.runId,
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
    } finally {
      human?.close();
      store.close();
    }
  },
});
