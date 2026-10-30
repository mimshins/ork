/**
 * @file `ork resume`: continues a stopped or crashed run with its recorded
 *   state (ADR-026). Finished nodes keep their results, the rest run again,
 *   with the inputs and flags the run started with unless they are changed.
 */

import { openStore } from "@krapht/ork-core";
import { defineCommand } from "citty";

import { createTerminalHuman } from "../human.ts";
import { style, write } from "../output.ts";
import { runWorkflowFile } from "../run/workflow.ts";
import { findRun } from "../runs/find.ts";
import { resumable } from "../runs/resume.ts";
import { flagValues, isDriver, loadRuntime, writeErr } from "./run.ts";

export const resume = defineCommand({
  meta: {
    name: "resume",
    description:
      "Continue a stopped or crashed run: finished nodes keep their results",
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
      description: "sdk or cli (default: the one the run used)",
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
  },
  run: async ({ args, rawArgs }) => {
    if (args.driver !== undefined && !isDriver(args.driver)) {
      writeErr(`--driver must be sdk or cli, got "${args.driver}"`);
      process.exitCode = 1;
      return;
    }
    const store = openStore();
    const human = createTerminalHuman({
      input: process.stdin,
      output: process.stderr,
      interactive: process.stdin.isTTY,
    });
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
        writeErr(ready.ok ? "" : ready.error);
        process.exitCode = 1;
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
        human,
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
      human.close();
      store.close();
    }
  },
});
