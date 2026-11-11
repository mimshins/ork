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
  type EventStore,
  findRun,
  type Noted,
  openStore,
  pendingDecisions,
  placeFor,
  recordNote,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { createTerminalHuman } from "../human.ts";
import { style, write, writeErr } from "../output.ts";
import { canKey } from "../term/mode.ts";
import { formatDecisions } from "./decide-list.ts";
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
    run: {
      type: "positional",
      description: "Only this run's decisions (an id or a prefix)",
      required: false,
    },
    all: {
      type: "boolean",
      description: "Every project's decisions",
      default: false,
    },
    list: {
      type: "boolean",
      description: "List them without answering",
      default: false,
    },
    json: { type: "boolean", description: "List them as JSON", default: false },
    workflow: {
      type: "string",
      description: "Only the decisions of this workflow's runs",
    },
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
    const answers =
      !args.document &&
      (args.id !== undefined ||
        args.choose !== undefined ||
        (process.stdin.isTTY && !args.list && !args.json));
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
      const filter: { runId?: string; project?: string; workflow?: string } =
        {};
      if (args.workflow !== undefined) filter.workflow = args.workflow;
      if (args.run !== undefined && args.run !== "") {
        const found = findRun(store, args.run, process.cwd());
        if (!found.ok) {
          failed(found.error);
          return;
        }
        filter.runId = found.run.id;
      } else if (!args.all) {
        filter.project = placeFor(process.cwd(), store.projects()).root;
      }
      const open = pendingDecisions(store, filter);
      if (args.json) {
        write(JSON.stringify(open, undefined, 2));
        return;
      }
      if (args.list || !process.stdin.isTTY || open.length === 0) {
        for (const line of formatDecisions(open, args.workflow)) write(line);
        return;
      }
      // A card collapses to the line that says what was chosen; only plain
      // output needs the answer's line as well.
      const collapses = canKey(process.stdin, process.stdout);
      for (const [index, d] of open.entries()) {
        const question: Parameters<typeof human.ask>[0] = {
          nodeId: d.node,
          question: d.question,
          options: d.options,
        };
        if (d.recommended !== undefined) question.recommended = d.recommended;
        if (d.context !== undefined) question.context = d.context;
        if (d.document !== undefined) question.document = d.document;
        let note: string | undefined;
        question.onNote = given => {
          note = given;
        };
        // oxlint-disable-next-line no-await-in-loop -- one question at a time
        const choice = await human.askAt(question, {
          run: d.runId,
          decision: d.id,
          index: index + 1,
          total: open.length,
        });
        // `q` leaves the question open for later.
        if (choice === null) continue;
        // oxlint-disable-next-line no-await-in-loop -- answered in order
        const answered = await answerDecision(
          store,
          d.id,
          choice,
          undefined,
          "decide",
          note,
        );
        if (!answered.ok) write(`${style("yellow", "!")} ${answered.error}\n`);
        else if (!collapses) {
          write(
            `${style("green", "✓")} ${d.id}: ${choice}${saidLine(store, d.id)}\n`,
          );
        }
      }
    } finally {
      human?.close();
      store.close();
    }
  },
});
