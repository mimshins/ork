/**
 * @file `ork run`: the command and its flags. It runs a whole workflow, or one
 *   Claude node with `--node`, with questions and permission prompts answered
 *   on the terminal.
 */

import { type ClaudeRuntime, openStore } from "@krapht/ork-core";
import { CLAUDE_DRIVERS } from "@krapht/ork-integrations";
import type { Driver } from "@krapht/ork-schema";
import { defineCommand } from "citty";

import { createTerminalHuman } from "../human.ts";
import { style, write, writeErr } from "../output.ts";
import { DETACHED_ENV, detachRun } from "../run/detach.ts";
import { runNode } from "../run/node.ts";
import { newRunId, runWorkflowFile } from "../run/workflow.ts";
import { workflowArg } from "../workflows.ts";

export const flagValues = (
  rawArgs: readonly string[],
  flag: string,
): string[] => {
  const values: string[] = [];
  for (const [index, arg] of rawArgs.entries()) {
    if (arg.startsWith(`${flag}=`)) values.push(arg.slice(flag.length + 1));
    else if (arg === flag) {
      const value = rawArgs[index + 1];
      if (value !== undefined) values.push(value);
    }
  }
  return values;
};

export const isDriver = (value: string): value is Driver =>
  CLAUDE_DRIVERS.some(d => d.id === value);

/** Loads the drivers only when a run starts, so other commands stay fast. */
export const loadRuntime = async (driver: Driver): Promise<ClaudeRuntime> =>
  (await import("@krapht/ork-runtime-claude")).createRuntime(
    driver,
    process.env,
  );

/** Ctrl-C asks the run to stop. */
const onInterrupt = (stop: () => void) => {
  process.once("SIGINT", () => {
    writeErr(style("dim", "\ninterrupting…"));
    stop();
  });
};

export const run = defineCommand({
  meta: {
    name: "run",
    description: "Run a workflow, or one Claude node of it with --node",
  },
  args: {
    workflow: {
      type: "positional",
      description:
        "A workflow file, or the name of one in the project's workflows (.ork/workflows/)",
      required: true,
    },
    node: {
      type: "string",
      description: "Run only this Claude node",
    },
    input: {
      type: "string",
      description: "A workflow input, name=value (repeatable)",
    },
    driver: {
      type: "string",
      description: "sdk (API key or cloud provider) or cli (your claude login)",
    },
    "in-place": {
      type: "boolean",
      description: "Run worktree nodes in this checkout, without worktrees",
      default: false,
    },
    "allow-dirty": {
      type: "boolean",
      description:
        "Run although instructions or skills have uncommitted changes (worktrees get the committed versions)",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print the events as JSON lines",
      default: false,
    },
    detach: {
      type: "boolean",
      description:
        "Run in the background; follow it with ork logs -f, answer with ork decide",
      default: false,
    },
    "run-id": {
      type: "string",
      description: "Internal: the id `--detach` picked for the run",
    },
  },
  run: async ({ args, rawArgs }) => {
    if (args.driver !== undefined && !isDriver(args.driver)) {
      writeErr(
        `--driver must be ${CLAUDE_DRIVERS.map(d => d.id).join(" or ")}, got "${args.driver}"`,
      );
      process.exitCode = 1;
      return;
    }
    const cwd = process.cwd();
    const target = workflowArg(args.workflow, cwd);
    const store = openStore();
    if (args.detach) {
      try {
        const single = args.node !== undefined && args.node !== "";
        const runId = newRunId(store, single ? "node-" : "");
        const detached = await detachRun({
          store,
          runId,
          rawArgs,
          cwd,
          runDir: target.runDir(runId),
        });
        if (detached.ok) {
          write(`▸ run ${detached.runId} started in the background`);
          write(
            style(
              "dim",
              `  ork logs ${detached.runId} -f · ork tree ${detached.runId} · ork decide · ork stop ${detached.runId}`,
            ),
          );
        } else {
          writeErr(detached.error);
          writeErr(style("dim", `(output: ${detached.log})`));
          process.exitCode = 1;
        }
      } finally {
        store.close();
      }
      return;
    }
    // A detached run has no terminal: its questions wait for `ork decide`.
    const human =
      process.env[DETACHED_ENV] === "1"
        ? undefined
        : createTerminalHuman({
            input: process.stdin,
            output: process.stderr,
            interactive: process.stdin.isTTY,
          });
    const common = {
      file: target.file,
      cwd,
      inputs: flagValues(rawArgs, "--input"),
      inPlace: args["in-place"],
      json: args.json,
      runtime: loadRuntime,
      store,
      ...(human === undefined ? {} : { human }),
      ...(args["run-id"] === undefined ? {} : { runId: args["run-id"] }),
      out: write,
      err: writeErr,
      ...(args.driver === undefined ? {} : { driver: args.driver }),
    };
    try {
      const { exitCode } =
        args.node === undefined || args.node === ""
          ? await runWorkflowFile({
              ...common,
              allowDirty: args["allow-dirty"],
              onRun: handle => {
                onInterrupt(handle.interrupt);
              },
            })
          : await runNode({
              ...common,
              nodeId: args.node,
              onSession: session => {
                onInterrupt(() => {
                  void session.interrupt();
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
