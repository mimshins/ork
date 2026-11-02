/**
 * @file The Claude node type: runs a `claude.leader` or `claude.worker` as one
 *   session, planned with the run's outputs (and the brief its owner gave it),
 *   and turns its report into the node's output. A leader gets its children
 *   through the session's ports, and resumes its session on re-entry
 *   (ADR-019).
 */

import path from "node:path";

import {
  type ClaudeRuntime,
  type ExecuteContext,
  type NodeExecutor,
  type NodeResult,
  planNodeSession,
  type SessionOutcome,
  type SessionUsage,
  type SessionPorts,
  type SessionSpec,
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

/**
 * What a resumed leader is told: it already has its brief and its earlier work,
 * so only the new round, and the new task when its owner sent one.
 */
export const resumeMessage = (
  round: number,
  input: unknown,
  brief?: { from: string; text: string },
): string =>
  [
    brief === undefined
      ? sentBack(round, input)
      : `## New task from \`${brief.from}\`\n\n${brief.text}`,
    "End with a new structured report.",
  ].join("\n\n");

/** A first-round resume is a session the run was cut off in (`ork resume`). */
const sentBack = (round: number, input: unknown): string =>
  round === 1
    ? "Ork was stopped while you worked on this task, and the run is resumed. Your earlier turns are above: check what you finished, and carry on from there."
    : `The workflow sent your task back to you.${reentryNote(round, input)}`;

/** What a session is told when messages came in as it finished. */
export const lateMessage = (count: number): string =>
  `[ork] ${String(count)} message${count === 1 ? "" : "s"} came in while you finished. Call read_inbox, act on ${count === 1 ? "it" : "them"} if needed, and end with a new structured report.`;

/** The later outcome, with the cost and tokens of both sessions. */
export const withUsageOf = (
  first: SessionOutcome,
  later: SessionOutcome,
): SessionOutcome => {
  const sum = (key: keyof SessionUsage) => first.usage[key] + later.usage[key];
  const usage: SessionUsage = {
    costUsd: sum("costUsd"),
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cacheReadTokens: sum("cacheReadTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
    turns: sum("turns"),
    durationMs: sum("durationMs"),
  };
  return { ...later, usage };
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
      sessionId: outcome.sessionId,
    };
  }
  const ran = { sessionId: outcome.sessionId };
  const output: Record<string, unknown> = {
    ...report.fields,
    status: report.status,
    summary: report.summary,
    artifacts: report.artifacts,
    usage,
  };
  if (report.branch !== undefined) output["branch"] = report.branch;
  const result: NodeResult = {
    ok: report.status !== "fail",
    output,
    usage,
    ...ran,
  };
  if (!result.ok) result.error = report.summary;
  return result;
};

/** A re-entered leader resumes; anyone else starts with the full brief. */
const specFor = (spec: SessionSpec, context: ExecuteContext): SessionSpec => {
  if (context.resume !== undefined) {
    return {
      ...spec,
      resume: context.resume,
      prompt: resumeMessage(context.round, context.input, context.brief),
    };
  }
  if (context.round > 1 && context.brief === undefined) {
    return {
      ...spec,
      prompt: spec.prompt + reentryNote(context.round, context.input),
    };
  }
  return spec;
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
      workflowDir: context.workflowDir,
      projectRoot: context.projectRoot,
      ...(context.orkDir === undefined ? {} : { orkDir: context.orkDir }),
      pluginDir: path.join(context.runDir, "plugins", context.id),
    };
    if (context.budgetLeftUsd !== undefined) {
      planOptions.budgetLeftUsd = context.budgetLeftUsd;
    }
    if (context.checkout !== undefined) planOptions.checkout = context.checkout;
    if (context.brief !== undefined) planOptions.brief = context.brief;
    if (context.template !== undefined) planOptions.template = context.template;
    if (context.ownership !== undefined) {
      planOptions.ownership = context.ownership;
    }
    if (context.mailbox !== undefined) planOptions.mailbox = context.mailbox;
    if (context.claims !== undefined) planOptions.claims = context.claims;
    const plan = planNodeSession(context.workflow, context.id, planOptions);
    if (!plan.ok) {
      return {
        ok: false,
        output: { status: "fail", summary: plan.error },
        error: plan.error,
      };
    }
    const spec = specFor(plan.spec, context);
    const runtime = await options.runtimeFor(options.driver ?? plan.driver);
    const ports: SessionPorts = { human: context.human };
    if (context.hold !== undefined) ports.hold = context.hold;
    if (context.ownership !== undefined) ports.ownership = context.ownership;
    if (context.mailbox !== undefined) ports.mailbox = context.mailbox;
    if (context.claims !== undefined) ports.claims = context.claims;
    if (context.feedback !== undefined) ports.feedback = context.feedback;
    const run = async (asked: SessionSpec): Promise<SessionOutcome | null> => {
      const session = runtime.start(asked, ports);
      const stop = () => {
        void session.interrupt();
      };
      context.signal.addEventListener("abort", stop, { once: true });
      // Notices of new messages and owner questions go into the live session.
      const disconnect = context.mailbox?.connect(notice => {
        session.send(notice);
      });
      let outcome: SessionOutcome | null = null;
      try {
        for await (const event of session.events) {
          if (event.type === "session.finished") outcome = event.outcome;
          context.emit(event);
        }
      } finally {
        disconnect?.();
        context.signal.removeEventListener("abort", stop);
      }
      return outcome;
    };
    const first = await run(spec);
    // A message that came while it wrote its report: one more turn to read it.
    const late = context.mailbox?.pending() ?? 0;
    const stopped = context.signal.aborted;
    if (first === null || first.report === null || late === 0 || stopped) {
      return resultOf(first);
    }
    const again = await run({
      ...spec,
      resume: first.sessionId,
      prompt: lateMessage(late),
    });
    return resultOf(again === null ? first : withUsageOf(first, again));
  };
