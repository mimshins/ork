import {
  type ClaudeRuntime,
  type HumanChannel,
  parseInputPairs,
  planNodeSession,
  resolveInputs,
  type Session,
  type SessionOutcome,
} from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";

import { formatReport, loadWorkflow } from "../commands/validate.ts";
import { style } from "../output.ts";
import { formatEvent } from "./format.ts";

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
