/**
 * @file `ork pause` and `ork continue`: pause a live run, or one of its nodes,
 *   from any terminal, and let it go on (ADR-041). Nothing new starts while a
 *   run is paused, and a running session waits before its next tool call;
 *   nothing it is doing is cut short. Both write to the store, then wake the
 *   run on its socket (specs/messaging.md).
 */

import {
  type Commanded,
  type EventStore,
  findRun,
  openStore,
  requestContinue,
  requestPause,
  type RunRecord,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { style, write, writeErr } from "../output.ts";
import { continueRefusal } from "./in-a-run.ts";

const args = {
  run: {
    type: "positional",
    description: "A run id or a prefix (default: this project's newest)",
    required: false,
  },
  node: {
    type: "string",
    description: "Only this node, not the whole run",
  },
} as const;

/** Finds the run, asks it, and says what happens next. */
const ask = async (
  runArg: string | undefined,
  request: (store: EventStore, run: RunRecord) => Promise<Commanded>,
  done: (run: RunRecord) => string,
): Promise<void> => {
  const store = openStore();
  try {
    const found = findRun(store, runArg, process.cwd());
    const asked = found.ok ? await request(store, found.run) : found;
    if (!asked.ok) {
      writeErr(asked.error);
      process.exitCode = 1;
      return;
    }
    if (found.ok) write(`${style("green", "✓")} ${done(found.run)}`);
  } finally {
    store.close();
  }
};

export const pause = defineCommand({
  meta: {
    name: "pause",
    description: "Pause a live run, or one node, before its next tool call",
  },
  args,
  run: ({ args: given }) =>
    ask(
      given.run,
      (store, run) => requestPause(store, run, undefined, given.node),
      run =>
        given.node === undefined
          ? `Run ${run.id} pauses: nothing new starts, and running sessions wait before their next tool call. Go on with: ork continue ${run.id}`
          : `${given.node} in run ${run.id} pauses before its next tool call. Go on with: ork continue ${run.id} --node ${given.node}`,
    ),
});

export const continueRun = defineCommand({
  meta: {
    name: "continue",
    description: "Let a paused run, or one paused node, go on",
  },
  args,
  run: async ({ args: given }) => {
    const refused = continueRefusal();
    if (refused !== null) {
      writeErr(refused);
      process.exitCode = 1;
      return;
    }
    await ask(
      given.run,
      (store, run) => requestContinue(store, run, undefined, given.node),
      run =>
        given.node === undefined
          ? `Run ${run.id} goes on.`
          : `${given.node} in run ${run.id} goes on.`,
    );
  },
});
