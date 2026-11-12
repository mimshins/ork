/**
 * @file `ork run`: the command and its flags. It runs a whole workflow, or one
 *   Claude node with `--node`, with questions and permission prompts answered
 *   on the terminal.
 */

import {
  type AgentRuntime,
  DETACHED_ENV,
  detachRun,
  newRunId,
  openStore,
} from "@krapht/ork-core";
import { AGENT_DRIVERS, DRIVER_IDS } from "@krapht/ork-integrations";
import { sessionEnv } from "@krapht/ork-nodes";
import { type Driver, retiredDriverHint } from "@krapht/ork-schema";
import { defineCommand } from "citty";

import { callsShown, createTerminalHuman } from "../human.ts";
import { detachHint, style, write, writeErr } from "../output.ts";
import { runNode } from "../run/node.ts";
import { runWorkflowFile } from "../run/workflow.ts";
import { refusedBuiltin, workflowArg } from "../workflows.ts";

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
  AGENT_DRIVERS.some(d => d.id === value);

/** Why `--driver` refuses a value: a retired id names its replacement. */
export const badDriver = (value: string): string =>
  `--${retiredDriverHint(value) ?? `driver must be one of ${AGENT_DRIVERS.map(d => d.id).join(", ")}, got \`${value}\``}`;

/** Loads the drivers only when a run starts, so other commands stay fast. */
export const loadRuntime = async (
  driver: Driver,
  runs?: string,
): Promise<AgentRuntime> =>
  (await import("@krapht/ork-runtime")).createRuntime(
    driver,
    sessionEnv(process.env),
    runs,
  );

/**
 * Ctrl-C asks the run to stop, and so does a terminal closing or a polite kill,
 * so that the run ends tidily and leaves no result unscrubbed.
 */
export const onInterrupt = (stop: () => void) => {
  let asked = false;
  const interrupt = () => {
    if (asked) return;
    asked = true;
    writeErr(style("dim", "\ninterrupting…"));
    stop();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  process.once("SIGHUP", interrupt);
};

/** The terminal that answers a run's questions; none in a detached run. */
export const terminalHuman = () => {
  const detached = process.env[DETACHED_ENV] === "1";
  if (detached) {
    writeErr(
      style(
        "dim",
        "detached run: no terminal asks; answer with ork attach or ork decide",
      ),
    );
  }
  return detached
    ? undefined
    : createTerminalHuman({
        input: process.stdin,
        output: process.stderr,
        interactive: process.stdin.isTTY,
        // Raises the real signal, so a second Ctrl-C still kills as usual.
        interrupt: () => {
          process.kill(process.pid, "SIGINT");
        },
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
        "A workflow file, the name of one in the project's workflows (.ork/workflows/), or one of Ork's own (ork:feedback-apply)",
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
    "follow-ups": {
      type: "string",
      description:
        "Follow-up ids an agent does (repeatable or comma-separated): they become the run's brief, done when it publishes",
    },
    driver: {
      type: "string",
      description: `${DRIVER_IDS.join(", ")} (default: the driver ready here)`,
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
    "machine-claude": {
      type: "boolean",
      description:
        "Sessions load this machine's Claude setup: its MCP servers and Claude's memory (default: clean sessions)",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print the events as JSON lines",
      default: false,
    },
    verbose: {
      type: "boolean",
      description:
        "Show each tool call whole, and why each failed node stopped, with its scrubbed details",
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
    "called-by": {
      type: "string",
      description: "Internal: the workflow.call that started this run",
    },
    "budget-cap": {
      type: "string",
      description: "Internal: what the caller has left of its budget",
    },
    "base-ref": {
      type: "string",
      description: "Internal: what this run's worktrees start from",
    },
    trigger: {
      type: "string",
      description: "Internal: the trigger that started this run",
    },
    "expect-workflow": {
      type: "string",
      description: "Internal: the hash the workflow's text must have",
    },
    untrusted: {
      type: "string",
      description: "Internal: an input from what a trigger's check reported",
    },
  },
  run: async ({ args, rawArgs }) => {
    if (args.driver !== undefined && !isDriver(args.driver)) {
      writeErr(badDriver(args.driver));
      process.exitCode = 1;
      return;
    }
    const cwd = process.cwd();
    if (refusedBuiltin([args.workflow], cwd)) return;
    const target = workflowArg(args.workflow, cwd);
    const store = openStore();
    if (args.detach) {
      try {
        const single = args.node !== undefined && args.node !== "";
        const runId = newRunId(store, single ? "node-" : "");
        const detached = await detachRun({
          store,
          runId,
          args: [
            "run",
            ...rawArgs.filter(arg => arg !== "--detach"),
            "--run-id",
            runId,
          ],
          cwd,
          runDir: target.runDir(runId),
        });
        if (detached.ok) {
          write(`▸ run ${detached.runId} started in the background`);
          write(style("dim", `  ${detachHint(detached.runId)}`));
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
    const { prepareFollowUps } = await import("../follow-ups/brief.ts");
    const taking = prepareFollowUps(store, rawArgs, args["run-id"], target);
    if (taking === undefined) {
      store.close();
      return;
    }
    const human = terminalHuman();
    const common = {
      file: target.file,
      cwd,
      inputs: taking.inputs,
      inPlace: args["in-place"],
      ...(args["machine-claude"] ? { machineClaude: true } : {}),
      json: args.json,
      verbose: args.verbose,
      runtime: loadRuntime,
      store,
      ...(human === undefined ? {} : { human }),
      ...(taking.runId === undefined ? {} : { runId: taking.runId }),
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
              ...(args["called-by"] === undefined
                ? {}
                : { calledBy: args["called-by"] }),
              ...(args["budget-cap"] === undefined
                ? {}
                : { budgetCap: Number(args["budget-cap"]) }),
              ...(args["base-ref"] === undefined
                ? {}
                : { baseRef: args["base-ref"] }),
              ...(args["expect-workflow"] === undefined
                ? {}
                : { expectWorkflow: args["expect-workflow"] }),
              ...(args.trigger === undefined
                ? {}
                : {
                    trigger: args.trigger,
                    untrusted: flagValues(rawArgs, "--untrusted"),
                  }),
              // A person at the terminal answers the called runs' questions too.
              ...(human === undefined
                ? {}
                : { showCalls: callsShown(human, process.stdin.isTTY) }),
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
