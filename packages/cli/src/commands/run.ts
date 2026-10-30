import {
  type ClaudeRuntime,
  type HumanChannel,
  parseInputPairs,
  planNodeSession,
  resolveInputs,
  type RuntimeEvent,
  type Session,
  type SessionOutcome,
} from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";
import { defineCommand } from "citty";

import { createTerminalHuman, previewInput } from "../human.ts";
import { style, write } from "../output.ts";
import { resolveWorkflowArg } from "../workflows.ts";
import { formatReport, loadWorkflow } from "./validate.ts";

export type RunNodeOptions = {
  file: string;
  cwd: string;
  nodeId: string;
  /** `name=value` pairs, as given to `--input`. */
  inputs: readonly string[];
  /** Overrides the node's and the workflow's driver. */
  driver?: Driver;
  inPlace: boolean;
  /** Print the runtime events as JSON lines instead of a transcript. */
  json: boolean;
  runtime: (driver: Driver) => Promise<ClaudeRuntime>;
  human: HumanChannel;
  out: (line: string) => void;
  err: (line: string) => void;
  onSession?: (session: Session) => void;
};

export type RunNodeResult = {
  exitCode: number;
  outcome: SessionOutcome | null;
};

const STATUS_MARK: Record<string, string> = {
  pass: style("green", "✓"),
  done: style("green", "✓"),
  changes_requested: style("yellow", "!"),
  fail: style("red", "✗"),
};

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

const indent = (text: string): string[] =>
  text
    .trimEnd()
    .split("\n")
    .map(line => `  ${line}`);

/** The usage line: cost, tokens, turns and time. */
export const formatUsage = ({ usage }: SessionOutcome): string =>
  style(
    "dim",
    [
      `$${usage.costUsd.toFixed(4)}`,
      `${String(usage.inputTokens)} in / ${String(usage.outputTokens)} out (${String(usage.cacheReadTokens)} cached)`,
      `${String(usage.turns)} turns`,
      seconds(usage.durationMs),
    ].join(" · "),
  );

/** How a finished session reads on the terminal. */
export const formatOutcome = (
  nodeId: string,
  outcome: SessionOutcome,
): string[] => {
  const { report } = outcome;
  if (report === null) {
    return [
      `${style("red", "✗")} ${style("bold", nodeId)} ended without a report (${outcome.subtype})`,
      ...outcome.errors.map(e => `  ${style("red", e)}`),
      `  ${formatUsage(outcome)}`,
    ];
  }
  const lines = [
    `${STATUS_MARK[report.status] ?? "-"} ${style("bold", nodeId)} ${report.status}: ${report.summary}`,
  ];
  if (report.branch !== undefined) lines.push(`  branch: ${report.branch}`);
  for (const [name, file] of Object.entries(report.artifacts)) {
    lines.push(`  ${name}: ${file}`);
  }
  for (const [name, value] of Object.entries(report.fields)) {
    lines.push(`  ${name}: ${JSON.stringify(value)}`);
  }
  lines.push(`  ${formatUsage(outcome)}`);
  return lines;
};

/** The transcript lines for one event; tool names come from `tools`. */
export const formatEvent = (
  nodeId: string,
  event: RuntimeEvent,
  tools: Map<string, string>,
): string[] => {
  if (event.type === "session.started") {
    return [
      style("dim", `▸ ${nodeId} (${event.model}, session ${event.sessionId})`),
    ];
  }
  if (event.type === "assistant.text") return indent(event.text);
  if (event.type === "tool.called") {
    tools.set(event.id, event.name);
    return [style("dim", `  · ${previewInput(event.name, event.input)}`)];
  }
  if (event.type === "tool.result") {
    return event.isError
      ? [style("red", `  ✗ ${tools.get(event.id) ?? "tool"} failed`)]
      : [];
  }
  return formatOutcome(nodeId, event.outcome);
};

const succeeded = (outcome: SessionOutcome | null): boolean =>
  outcome?.report !== null &&
  outcome?.report !== undefined &&
  outcome.report.status !== "fail";

/**
 * Runs one Claude node of a workflow on its own: checks the workflow and the
 * inputs, plans the session, and streams it to the terminal.
 */
export const runNode = async (
  options: RunNodeOptions,
): Promise<RunNodeResult> => {
  const failed = (lines: string[]): RunNodeResult => {
    for (const line of lines) options.err(line);
    return { exitCode: 1, outcome: null };
  };

  const { report, workflow } = loadWorkflow(options.file, options.cwd);
  if (workflow === null) return failed(formatReport(report));

  const pairs = parseInputPairs(options.inputs);
  if (!pairs.ok) return failed([`--input: ${pairs.error}`]);
  const inputs = resolveInputs(workflow, pairs.raw);
  if (!inputs.ok) return failed(inputs.errors);

  const plan = planNodeSession(workflow, options.nodeId, {
    cwd: options.cwd,
    inputs: inputs.inputs,
    inPlace: options.inPlace,
  });
  if (!plan.ok) return failed([plan.error]);
  for (const warning of plan.warnings) {
    options.err(`${style(["yellow", "bold"], "warning")} ${warning}`);
  }

  const runtime = await options.runtime(options.driver ?? plan.driver);
  const session = runtime.start(plan.spec, options.human);
  options.onSession?.(session);

  const tools = new Map<string, string>();
  let outcome: SessionOutcome | null = null;
  for await (const event of session.events) {
    if (event.type === "session.finished") outcome = event.outcome;
    if (options.json) options.out(JSON.stringify(event));
    else
      for (const line of formatEvent(options.nodeId, event, tools)) {
        options.out(line);
      }
  }
  return { exitCode: succeeded(outcome) ? 0 : 1, outcome };
};

/** Every value of a repeatable flag: `--input a=1 --input=b=2`. */
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

const DRIVERS: readonly Driver[] = ["sdk", "cli"];

const isDriver = (value: string): value is Driver =>
  DRIVERS.some(d => d === value);

/** Loads the drivers only when a run starts, so other commands stay fast. */
const loadRuntime = async (driver: Driver): Promise<ClaudeRuntime> => {
  const drivers = await import("@krapht/ork-runtime-claude");
  return driver === "cli"
    ? drivers.createCliRuntime()
    : drivers.createSdkRuntime(process.env);
};

const writeErr = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

export const run = defineCommand({
  meta: {
    name: "run",
    description:
      "Run one Claude node of a workflow (--node); whole workflows arrive with the scheduler",
  },
  args: {
    workflow: {
      type: "positional",
      description: "A workflow file, or the name of one in .ork/workflows/",
      required: true,
    },
    node: {
      type: "string",
      description: "The Claude node to run",
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
      description:
        "Run a worktree node in this checkout (until the worktree manager)",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print the session's events as JSON lines",
      default: false,
    },
  },
  run: async ({ args, rawArgs }) => {
    if (args.node === undefined || args.node === "") {
      writeErr(
        "Pass --node <id>: running a whole workflow arrives with the scheduler.",
      );
      process.exitCode = 1;
      return;
    }
    if (args.driver !== undefined && !isDriver(args.driver)) {
      writeErr(`--driver must be sdk or cli, got "${args.driver}"`);
      process.exitCode = 1;
      return;
    }
    const cwd = process.cwd();
    const human = createTerminalHuman({
      input: process.stdin,
      output: process.stderr,
      interactive: process.stdin.isTTY,
    });
    const options: RunNodeOptions = {
      file: resolveWorkflowArg(args.workflow, cwd),
      cwd,
      nodeId: args.node,
      inputs: flagValues(rawArgs, "--input"),
      inPlace: args["in-place"],
      json: args.json,
      runtime: loadRuntime,
      human,
      out: write,
      err: writeErr,
      onSession: session => {
        process.once("SIGINT", () => {
          writeErr(style("dim", "\ninterrupting…"));
          void session.interrupt();
        });
      },
    };
    if (args.driver !== undefined) options.driver = args.driver;
    try {
      const { exitCode } = await runNode(options);
      process.exitCode = exitCode;
    } finally {
      human.close();
    }
  },
});
