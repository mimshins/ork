/**
 * @file `ork run`: the command and its flags. It runs a whole workflow, or one
 *   Claude node with `--node`, with questions and permission prompts answered
 *   on the terminal.
 */

import type { ClaudeRuntime } from "@krapht/ork-core";
import { CLAUDE_DRIVERS } from "@krapht/ork-integrations";
import type { Driver } from "@krapht/ork-schema";
import { defineCommand } from "citty";

import { createTerminalHuman } from "../human.ts";
import { style, write } from "../output.ts";
import { runNode } from "../run/node.ts";
import { runWorkflowFile } from "../run/workflow.ts";
import { resolveWorkflowArg } from "../workflows.ts";

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

const isDriver = (value: string): value is Driver =>
  CLAUDE_DRIVERS.some(d => d.id === value);

/** Loads the drivers only when a run starts, so other commands stay fast. */
const loadRuntime = async (driver: Driver): Promise<ClaudeRuntime> =>
  (await import("@krapht/ork-runtime-claude")).createRuntime(
    driver,
    process.env,
  );

const writeErr = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

export const run = defineCommand({
  meta: {
    name: "run",
    description: "Run a workflow, or one Claude node of it with --node",
  },
  args: {
    workflow: {
      type: "positional",
      description: "A workflow file, or the name of one in .ork/workflows/",
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
    const human = createTerminalHuman({
      input: process.stdin,
      output: process.stderr,
      interactive: process.stdin.isTTY,
    });
    const common = {
      file: resolveWorkflowArg(args.workflow, cwd),
      cwd,
      inputs: flagValues(rawArgs, "--input"),
      inPlace: args["in-place"],
      json: args.json,
      runtime: loadRuntime,
      human,
      out: write,
      err: writeErr,
      ...(args.driver === undefined ? {} : { driver: args.driver }),
    };
    const onInterrupt = (stop: () => void) => {
      process.once("SIGINT", () => {
        writeErr(style("dim", "\ninterrupting…"));
        stop();
      });
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
      human.close();
    }
  },
});
