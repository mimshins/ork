/**
 * @file `ork decide` and `ork stop`: answer a live run's open decisions, and
 *   stop a live run, from any terminal. Both write to the store, then wake the
 *   run on its socket (specs/messaging.md).
 */

import { setTimeout as sleep } from "node:timers/promises";

import {
  type DecisionRecord,
  liveStatus,
  openStore,
  projectRootOf,
  socketPath,
  wakeRun,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { createTerminalHuman } from "../human.ts";
import { style, write } from "../output.ts";
import { answerDecision, pendingDecisions } from "../runs/decide.ts";
import { findRun } from "../runs/find.ts";

const writeErr = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

const failed = (message: string): void => {
  writeErr(message);
  process.exitCode = 1;
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
  },
  run: async ({ args }) => {
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
        if (answered.ok)
          write(`${style("green", "✓")} ${args.id}: ${args.choose}`);
        else failed(answered.error);
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
        filter.project = projectRootOf(process.cwd());
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
      human.close();
      store.close();
    }
  },
});

export const stop = defineCommand({
  meta: { name: "stop", description: "Stop a live run" },
  args: {
    run: {
      type: "positional",
      description: "A run id or a prefix (default: this project's newest)",
      required: false,
    },
  },
  run: async ({ args }) => {
    const store = openStore();
    try {
      const found = findRun(store, args.run, process.cwd());
      if (!found.ok) {
        failed(found.error);
        return;
      }
      const { run } = found;
      const status = liveStatus(run);
      if (status !== "running") {
        failed(`Run ${run.id} is not running (${status}).`);
        return;
      }
      store.command(run.id, "stop");
      await wakeRun(socketPath(run.id));
      for (let i = 0; i < 150; i += 1) {
        const [now] = store.lookup(run.id);
        if (now !== undefined && liveStatus(now) !== "running") {
          write(`${style("green", "✓")} run ${run.id} ${liveStatus(now)}`);
          return;
        }
        // oxlint-disable-next-line no-await-in-loop -- waiting for the run to finish stopping
        await sleep(100);
      }
      write(
        `Asked run ${run.id} to stop; it is still finishing its running nodes (see ork logs ${run.id} -f).`,
      );
    } finally {
      store.close();
    }
  },
});
