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
  declaredOutputOf,
  type ExecuteContext,
  type NodeExecutor,
  planNodeSession,
  type SessionOutcome,
  type SessionPorts,
  sessionDriver,
  type SessionSpec,
  type StepRun,
} from "@krapht/ork-core";
import { beforeOf, type Driver } from "@krapht/ork-schema";

import { resultOf } from "./claude-result.ts";
import { namedMcpEntries } from "./mcp-servers.ts";
import { ownerFirst } from "./owner-asks.ts";
import {
  afterLateTurn,
  budgetNow,
  lateLimits,
  limitWatch,
  notStarted,
  type TurnLimits,
} from "./session-turns.ts";
import {
  checkedResult,
  checkFailedMessage,
  checkReport,
  isAcceptance,
  runStep,
  beforeFailed,
  noSteps,
} from "./verify.ts";

export { resultOf };

export type ClaudeExecutorOptions = {
  runtimeFor: (driver: Driver) => Promise<ClaudeRuntime>;
  /** Overrides every node's driver, as `ork run --driver` does. */
  driver?: Driver;
  /** The driver ready here when the run started, for nodes that name none. */
  readyDriver?: Driver;
  /** Sessions load the machine's Claude setup (`--machine-claude`, ADR-065). */
  machineClaude?: boolean;
  /** Runs `worktree` nodes in the project checkout instead of worktrees. */
  inPlace: boolean;
  /** What runs a node's `verify:`: the tool nodes' executor. */
  steps?: NodeExecutor;
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
    if (context.checkout !== undefined) planOptions.checkout = context.checkout;
    if (context.brief !== undefined) planOptions.brief = context.brief;
    if (context.template !== undefined) planOptions.template = context.template;
    if (context.ownership !== undefined) {
      planOptions.ownership = context.ownership;
    }
    if (context.mailbox !== undefined) planOptions.mailbox = context.mailbox;
    if (context.claims !== undefined) planOptions.claims = context.claims;
    const before = beforeOf(context.node, context.workflow.defaults);
    if (before !== undefined) {
      const ran = await runStep(options.steps ?? noSteps, context, before, {
        name: "before",
        try: 1,
      });
      if (!ran.ok) return beforeFailed(ran);
      // A step that outlived a stop, or a pause, must not lead to a model turn.
      await context.hold?.wait("start", context.signal);
      if (context.signal.aborted) {
        return beforeFailed({ ...ran, error: "the node was stopped" });
      }
      planOptions.before = ran.output;
    }
    // Checked now: a step, or the node's checkout, may have taken a while.
    const blocked = context.quota?.().blocked;
    if (blocked !== undefined) return notStarted(blocked, blocked);
    const budget = budgetNow(context);
    if (budget !== undefined && budget <= 0) {
      return notStarted("nothing is left of the run's budget");
    }
    if (budget !== undefined) planOptions.budgetLeftUsd = budget;
    const plan = planNodeSession(context.workflow, context.id, planOptions);
    if (!plan.ok) {
      return {
        ok: false,
        output: { status: "fail", summary: plan.error },
        error: plan.error,
      };
    }
    const servers = namedMcpEntries(context.projectRoot, plan.mcp);
    if (!servers.ok) return notStarted(servers.error);
    const spec = { ...specFor(plan.spec, context), ...servers.value };
    if (options.machineClaude === true) spec.machineClaude = true;
    const driver = sessionDriver({
      override: options.driver,
      named: plan.driver,
      ready: options.readyDriver,
    });
    if (driver === undefined) {
      return notStarted("no Claude driver is ready; see `ork doctor`");
    }
    const runtime = await options.runtimeFor(driver);
    const ports: SessionPorts = {
      // A leader that takes its children's questions answers them first.
      human:
        context.owner === undefined
          ? context.human
          : ownerFirst(context, context.owner, {
              runtimeFor: options.runtimeFor,
              driver: options.driver,
              readyDriver: options.readyDriver,
              inPlace: options.inPlace,
            }),
    };
    if (context.hold !== undefined) ports.hold = context.hold;
    if (context.ownership !== undefined) ports.ownership = context.ownership;
    if (context.mailbox !== undefined) ports.mailbox = context.mailbox;
    if (context.claims !== undefined) ports.claims = context.claims;
    if (context.feedback !== undefined) ports.feedback = context.feedback;
    const watch = limitWatch(context);
    const run = async (asked: SessionSpec): Promise<SessionOutcome | null> => {
      const watching = watch.session(asked);
      const session = runtime.start(asked, ports);
      const stop = () => {
        void session.interrupt();
      };
      context.signal.addEventListener("abort", stop, { once: true });
      // A listener never hears an abort that has already happened.
      if (context.signal.aborted) stop();
      // Notices of new messages and owner questions go into the live session.
      const disconnect = context.mailbox?.connect(notice => {
        session.send(notice);
      });
      let outcome: SessionOutcome | null = null;
      try {
        for await (const event of session.events) {
          if (event.type === "session.finished") outcome = event.outcome;
          watching.saw(event);
          context.emit(event);
        }
      } finally {
        disconnect?.();
        context.signal.removeEventListener("abort", stop);
      }
      watching.ended(outcome);
      return outcome;
    };
    const first = await run(spec);
    const limitsAfter = ({
      sessionId,
      usage,
    }: SessionOutcome): TurnLimits | null => {
      const quota = context.quota?.();
      if (quota?.blocked !== undefined) {
        watch.stoppedBy(quota.blocked);
        return null;
      }
      return lateLimits(
        spec,
        {
          // A re-entered session reports what it spent in earlier activations.
          spent: context.ownSpend?.(sessionId, usage.costUsd) ?? usage.costUsd,
          turns: usage.turns,
        },
        context.budgetLeftNow?.(),
        quota?.leftUsd,
      );
    };
    const resumeWith = (
      outcome: SessionOutcome,
      prompt: string,
      limits: TurnLimits,
    ) => run({ ...spec, ...limits, resume: outcome.sessionId, prompt });
    // A message that came while it wrote its report: one more turn to read it.
    const lateTurn = (
      current: SessionOutcome,
    ): Promise<SessionOutcome | null> => {
      const late = context.mailbox?.pending() ?? 0;
      const limits = limitsAfter(current);
      return late === 0 || context.signal.aborted || limits === null
        ? Promise.resolve(null)
        : resumeWith(current, lateMessage(late), limits);
    };
    const again =
      first === null || first.report === null ? null : await lateTurn(first);
    const outcome =
      first === null || again === null ? first : afterLateTurn(first, again);
    const { node } = context;
    const verify = "verify" in node ? node.verify : undefined;
    if (outcome === null || verify === undefined || !isAcceptance(outcome)) {
      return watch.result(resultOf(outcome, declaredOutputOf(node)));
    }
    // Each try of the check keeps what it printed in its own files.
    let tries = 0;
    const step = (): StepRun => ({ name: "verify", try: tries });
    const checked = await checkReport({
      verify,
      first: outcome,
      signal: context.signal,
      check: () => {
        tries += 1;
        return runStep(options.steps ?? noSteps, context, verify, step());
      },
      late: lateTurn,
      resume: async (current, check) => {
        const limits = limitsAfter(current);
        if (limits === null) return null;
        // A paused node spends no model turn until it continues.
        await context.hold?.wait("start", context.signal);
        return context.signal.aborted
          ? null
          : resumeWith(
              current,
              checkFailedMessage(check, { ...context, step: step() }),
              limits,
            );
      },
    });
    return watch.result(
      checkedResult(resultOf(checked.outcome, declaredOutputOf(node)), checked),
    );
  };
