/**
 * @file `ork decide`: answer a live run's open decisions from any terminal (it
 *   writes to the store, then wakes the run on its socket; specs/messaging.md).
 *   With `--id` and `--choose`, `--note` and `--rating` also note how the
 *   decision's node went, as the run's feedback (specs/feedback.md).
 */

import {
  answerDecision,
  type DecisionRecord,
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
  return recordNote(store, run, {
    text: note ?? `Rated ${rating ?? ""} at ${decision.question}`,
    node: decision.node,
    rating,
  });
};

/** One line per open decision, for `--list`. */
export const formatDecisions = (
  decisions: readonly DecisionRecord[],
): string[] =>
  decisions.length === 0
    ? ["No open decisions."]
    : decisions.map(
        d =>
          `${style("bold", d.id)}  ${style("cyan", d.node)}  ${d.question} ${style("dim", `[${d.options.map(o => (o.id === d.recommended ? `${o.id}*` : o.id)).join(", ")}]`)}`,
      );

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
    id: { type: "string", description: "Answer this decision…" },
    choose: { type: "string", description: "…with this option" },
    note: {
      type: "string",
      description:
        "…and note how its node went; the note joins the run's feedback",
    },
    rating: { type: "string", description: "…rating it good or bad" },
  },
  run: async ({ args }) => {
    const answers =
      args.id !== undefined ||
      args.choose !== undefined ||
      (process.stdin.isTTY && !args.list && !args.json);
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
    });
    try {
      if (args.id !== undefined || args.choose !== undefined) {
        if (args.id === undefined || args.choose === undefined) {
          failed("--id and --choose go together.");
          return;
        }
        const answered = await answerDecision(store, args.id, args.choose);
        if (!answered.ok) {
          failed(answered.error);
          return;
        }
        write(`${style("green", "✓")} ${args.id}: ${args.choose}`);
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
      const filter: { runId?: string; project?: string } = {};
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
        for (const line of formatDecisions(open)) write(line);
        return;
      }
      for (const d of open) {
        write(style("dim", `run ${d.runId} · decision ${d.id}`));
        const question: Parameters<typeof human.ask>[0] = {
          nodeId: d.node,
          question: d.question,
          options: d.options,
        };
        if (d.recommended !== undefined) question.recommended = d.recommended;
        if (d.context !== undefined) question.context = d.context;
        // oxlint-disable-next-line no-await-in-loop -- one question at a time
        const choice = await human.ask(question);
        // oxlint-disable-next-line no-await-in-loop -- answered in order
        const answered = await answerDecision(store, d.id, choice);
        write(
          answered.ok
            ? `${style("green", "✓")} ${d.id}: ${choice}\n`
            : `${style("yellow", "!")} ${answered.error}\n`,
        );
      }
    } finally {
      human?.close();
      store.close();
    }
  },
});
