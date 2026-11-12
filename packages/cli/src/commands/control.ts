/**
 * @file `ork stop` and `ork resume`: stop a live run, or one of its nodes
 *   (ADR-041), from any terminal (it writes to the store, then wakes the run on
 *   its socket; specs/messaging.md), and continue a stopped or crashed run with
 *   its recorded state (ADR-026). `ork decide` is in `decide.ts`.
 */

import { setTimeout as sleep } from "node:timers/promises";

import {
  detachResume,
  findRun,
  liveStatus,
  openStore,
  requestStop,
  resumable,
} from "@krapht/ork-core";
import { DRIVER_IDS } from "@krapht/ork-integrations";
import { defineCommand } from "citty";

import { style, write, writeErr } from "../output.ts";
import { runWorkflowFile } from "../run/workflow.ts";
import {
  badDriver,
  flagValues,
  isDriver,
  loadRuntime,
  terminalHuman,
} from "./run.ts";

const failed = (message: string): void => {
  writeErr(message);
  process.exitCode = 1;
};

export * from "./decide.ts";
export * from "./decide-list.ts";

export const stop = defineCommand({
  meta: { name: "stop", description: "Stop a live run, or one of its nodes" },
  args: {
    run: {
      type: "positional",
      description: "A run id or a prefix (default: this project's newest)",
      required: false,
    },
    node: {
      type: "string",
      description: "Stop only this running node: it fails, and the run goes on",
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
      const asked = await requestStop(store, run, undefined, args.node);
      if (!asked.ok) {
        failed(asked.error);
        return;
      }
      if (args.node !== undefined) {
        write(
          `${style("green", "✓")} ${args.node} in run ${run.id} stops: its session is interrupted and it fails, "stopped by the user"; the run goes on.`,
        );
        return;
      }
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

/** Continues a run: finished nodes keep their results (ADR-026). */
export const resume = defineCommand({
  meta: {
    name: "resume",
    description:
      "Continue a run that didn't succeed (stopped, failed or crashed): finished nodes keep their results",
  },
  args: {
    run: {
      type: "positional",
      description:
        "A run id or a prefix of one (default: this project's newest)",
      required: false,
    },
    input: {
      type: "string",
      description: "Change a workflow input, name=value (repeatable)",
    },
    driver: {
      type: "string",
      description: `${DRIVER_IDS.join(", ")} (default: the one the run used)`,
    },
    "in-place": {
      type: "boolean",
      description:
        "Run worktree nodes in this checkout (default: as the run did)",
    },
    "allow-dirty": {
      type: "boolean",
      description:
        "Resume although instructions or skills have uncommitted changes",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print the events as JSON lines",
      default: false,
    },
    detach: {
      type: "boolean",
      description: "Resume in the background; answer with ork decide",
      default: false,
    },
  },
  run: async ({ args, rawArgs }) => {
    if (args.driver !== undefined && !isDriver(args.driver)) {
      failed(badDriver(args.driver));
      return;
    }
    const store = openStore();
    const human = terminalHuman();
    try {
      const found = findRun(store, args.run, process.cwd());
      const ready = found.ok
        ? resumable(store, found.run, {
            ...(args["in-place"] === undefined
              ? {}
              : { inPlace: args["in-place"] }),
            ...(args.driver === undefined ? {} : { driver: args.driver }),
          })
        : found;
      if (!found.ok || !ready.ok) {
        failed(ready.ok ? "" : ready.error);
        return;
      }
      if (args.detach) {
        const flags = rawArgs.filter(a => a !== "--detach" && a !== args.run);
        const detached = await detachResume(store, found.run, flags);
        if (detached.ok)
          write(`▸ run ${found.run.id} resumed in the background`);
        else failed(`${detached.error}\n(output: ${detached.log})`);
        return;
      }
      const { exitCode } = await runWorkflowFile({
        file: found.run.file,
        cwd: found.run.project,
        inputs: flagValues(rawArgs, "--input"),
        inPlace: ready.inPlace,
        allowDirty: args["allow-dirty"],
        json: args.json,
        runtime: loadRuntime,
        store,
        ...(human === undefined ? {} : { human }),
        runId: found.run.id,
        resume: ready.state,
        out: write,
        err: writeErr,
        ...(ready.driver === undefined ? {} : { driver: ready.driver }),
        onRun: handle => {
          process.once("SIGINT", () => {
            writeErr(style("dim", "\ninterrupting…"));
            handle.interrupt();
          });
        },
      });
      process.exitCode = exitCode;
    } finally {
      human?.close();
      store.close();
    }
  },
});
