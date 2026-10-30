import {
  type ClaudeRuntime,
  type NodeExecutor,
  type NodeResult,
  planNodeSession,
  type SessionOutcome,
} from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";

export type ClaudeExecutorOptions = {
  runtimeFor: (driver: Driver) => Promise<ClaudeRuntime>;
  /** Overrides every node's driver, as `ork run --driver` does. */
  driver?: Driver;
  /** Runs `worktree` nodes in the project checkout instead of worktrees. */
  inPlace: boolean;
};

const MAX_INPUT = 8192;

/** On a loop re-entry, the brief carries what the workflow sent back. */
export const reentryNote = (round: number, input: unknown): string => {
  const json = JSON.stringify(input ?? {}, undefined, 2);
  const body =
    json.length > MAX_INPUT ? `${json.slice(0, MAX_INPUT)}\n…` : json;
  return `\n\n## Round ${String(round)}\n\nThe workflow sent this task back to you with:\n\n\`\`\`json\n${body}\n\`\`\``;
};

/** A finished session as a node result: its report is the node's output. */
export const resultOf = (outcome: SessionOutcome | null): NodeResult => {
  if (outcome === null) {
    return {
      ok: false,
      output: { status: "fail", summary: "the session ended without a result" },
      error: "the session ended without a result",
    };
  }
  const { report, usage } = outcome;
  if (report === null) {
    const reason = outcome.errors[0] ?? "no valid report";
    return {
      ok: false,
      output: { status: "fail", summary: reason, usage },
      usage,
      error: `ended without a report (${outcome.subtype}): ${reason}`,
    };
  }
  const output: Record<string, unknown> = {
    ...report.fields,
    status: report.status,
    summary: report.summary,
    artifacts: report.artifacts,
    usage,
  };
  if (report.branch !== undefined) output["branch"] = report.branch;
  const result: NodeResult = { ok: report.status !== "fail", output, usage };
  if (!result.ok) result.error = report.summary;
  return result;
};

/** Runs a `claude.leader` or `claude.worker` as one session. */
export const claudeExecutor =
  (options: ClaudeExecutorOptions): NodeExecutor =>
  async context => {
    const planOptions: Parameters<typeof planNodeSession>[2] = {
      cwd: context.cwd,
      inputs: context.inputs,
      outputs: context.outputs,
      inPlace: options.inPlace,
    };
    if (context.budgetLeftUsd !== undefined) {
      planOptions.budgetLeftUsd = context.budgetLeftUsd;
    }
    if (context.checkout !== undefined) planOptions.checkout = context.checkout;
    const plan = planNodeSession(context.workflow, context.id, planOptions);
    if (!plan.ok) {
      return {
        ok: false,
        output: { status: "fail", summary: plan.error },
        error: plan.error,
      };
    }
    const spec =
      context.round > 1
        ? {
            ...plan.spec,
            prompt:
              plan.spec.prompt + reentryNote(context.round, context.input),
          }
        : plan.spec;
    const runtime = await options.runtimeFor(options.driver ?? plan.driver);
    const session = runtime.start(spec, context.human);
    context.signal.addEventListener(
      "abort",
      () => {
        void session.interrupt();
      },
      { once: true },
    );
    let outcome: SessionOutcome | null = null;
    for await (const event of session.events) {
      if (event.type === "session.finished") outcome = event.outcome;
      context.emit(event);
    }
    return resultOf(outcome);
  };
