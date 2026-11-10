/**
 * @file A child's question to its leader first (`questions: owner`, ADR-063).
 *   Ork resumes a fork of the leader's latest session that can only read, and
 *   asks it the child's question: it answers with one of the options when what
 *   it was given settles it, or passes the question on to the person with a
 *   note. A leader with no session yet, a fork that fails, runs out of turns,
 *   budget or time, or gives no valid choice, and a run with nothing left to
 *   spend all pass it on too, so the child never waits on the leader for good.
 *   Permission prompts and gates stay with the person.
 */

import {
  type AgentRuntime,
  type DecisionChoice,
  type ExecuteContext,
  type HumanChannel,
  type HumanQuestion,
  type OwnerPort,
  planNodeSession,
  reportSchemaFor,
  type SessionOutcome,
  type SessionSpec,
  sessionDriver,
} from "@krapht/ork-core";
import type { ClaudeNode, Driver } from "@krapht/ork-schema";

/** The fork's turns: it answers, it doesn't work. */
export const FORK_MAX_TURNS = 3;

/** The fork's wall-clock bound; past it, the person is asked. */
export const FORK_TIMEOUT_MS = 5 * 60_000;

/** The only built-in tools a fork has: it reads, and reports. */
export const FORK_TOOLS: readonly string[] = ["Read", "Grep", "Glob"];

/**
 * The option that passes a question on: `ask-user`, or the first free
 * `ask-user-<n>`.
 */
export const passOnId = (options: readonly DecisionChoice[]): string => {
  let id = "ask-user";
  for (let n = 2; options.some(option => option.id === id); n += 1) {
    id = `ask-user-${String(n)}`;
  }
  return id;
};

const optionLine = (option: DecisionChoice): string =>
  [
    `- \`${option.id}\``,
    option.label === undefined ? "" : `: ${option.label}`,
    option.description === undefined ? "" : ` (${option.description})`,
  ].join("");

/** What the fork is asked. */
export const forkPrompt = (question: HumanQuestion, passOn: string): string =>
  [
    `[ork] \`${question.nodeId}\`, which you own, asks a question (ask_user). You take its questions before the user does.`,
    "",
    `Question: ${question.question}`,
    ...(question.context === undefined ? [] : [`Context: ${question.context}`]),
    "Options:",
    ...question.options.map(optionLine),
    ...(question.recommended === undefined
      ? []
      : [`It recommends \`${question.recommended}\`.`]),
    "",
    `If your task, and what was agreed with the user, already settle it, report that option as \`choice\`. If they don't, or it is the user's to decide, report \`${passOn}\` to pass it on to the user. Either way, say why in \`note\`, in a sentence or two: it goes to \`${question.nodeId}\` with your answer, or to the user with the question. This is a side conversation: change nothing, and your own session goes on as it was.`,
  ].join("\n");

/** The fork's report: one of the options or the pass-on, and a note. */
const forkReportSchema = (ids: readonly string[]) => {
  const node: ClaudeNode = {
    type: "claude.worker",
    prompt: "",
    output: { schema: { choice: [...ids], note: "string" } },
  };
  return reportSchemaFor(node);
};

export type ForkAnswer = { choice: string; note?: string };

export type ForkDeps = {
  runtimeFor: (driver: Driver) => Promise<AgentRuntime>;
  /** `--driver`, for a leader whose session recorded none. */
  driver?: Driver | undefined;
  readyDriver?: Driver | undefined;
  inPlace: boolean;
  /** The fork's wall-clock bound, `FORK_TIMEOUT_MS` unless a test sets it. */
  timeoutMs?: number;
};

/** A fork can't ask anyone: it answers or passes the question on. */
const NO_ONE: HumanChannel = {
  permit: () =>
    Promise.resolve({
      allow: false,
      message: "A fork answering a question can't ask for permission.",
    }),
  ask: () => Promise.reject(new Error("a fork can't ask the user")),
};

/** The fork's session spec, from the leader's own plan; `null` if it can't. */
const forkSpec = (
  context: ExecuteContext,
  owner: OwnerPort,
  question: HumanQuestion,
  passOn: string,
  deps: ForkDeps,
): { spec: SessionSpec; driver: Driver } | null => {
  const session = owner.session();
  const left = owner.budgetLeftUsd();
  if (session === undefined || (left !== undefined && left <= 0)) return null;
  const plan = planNodeSession(context.workflow, owner.id, {
    cwd: session.cwd,
    inputs: context.inputs,
    outputs: context.outputs,
    inPlace: deps.inPlace,
    workflowDir: context.workflowDir,
    projectRoot: context.projectRoot,
    ...(context.orkDir === undefined ? {} : { orkDir: context.orkDir }),
    ...(left === undefined ? {} : { budgetLeftUsd: left }),
  });
  if (!plan.ok) return null;
  const driver =
    session.driver ??
    sessionDriver({
      override: deps.driver,
      named: plan.driver,
      ready: deps.readyDriver,
    });
  if (driver === undefined) return null;
  const ids = [...question.options.map(option => option.id), passOn];
  const spec: SessionSpec = {
    ...plan.spec,
    cwd: session.cwd,
    prompt: forkPrompt(question, passOn),
    resume: session.sessionId,
    fork: true,
    maxTurns: FORK_MAX_TURNS,
    // Read-only by what it has, not by what it is denied: no shell, no
    // subagents, no MCP server but Ork's; the project's own denials still hold.
    tools: {
      allow: [...FORK_TOOLS],
      deny: [...plan.spec.tools.deny, "mcp__ork__ask_user"],
      only: [...FORK_TOOLS],
      strictMcp: true,
    },
    reportSchema: forkReportSchema(ids),
  };
  // Its tools and prompt differ from the leader's, so it can't read the
  // leader's cached prefix: no hour-long cache write for one question.
  delete spec.promptCache;
  delete spec.agents;
  delete spec.plugins;
  return { driver, spec };
};

/** The choice a fork's outcome gives, if it is a valid one. */
const answerOf = (
  outcome: SessionOutcome | null,
  ids: readonly string[],
): ForkAnswer | null => {
  const fields = outcome?.report?.fields ?? {};
  const { choice, note } = fields;
  if (outcome?.subtype !== "success" || typeof choice !== "string") return null;
  if (!ids.includes(choice)) return null;
  return typeof note === "string" && note.trim() !== ""
    ? { choice, note: note.trim() }
    : { choice };
};

/**
 * Asks a fork of the owner's latest session; `null` when it can't answer: no
 * session yet, nothing left to spend, the node stopped, or a fork that fails,
 * runs out of time or gives no valid choice. A paused run or node starts no
 * fork until it goes on; one already started isn't paused, as it is bounded by
 * its turns and `timeoutMs`. Its events are the owner's, each marked as a fork,
 * and its spend the run's.
 */
export const askFork = async (
  context: ExecuteContext,
  owner: OwnerPort,
  question: HumanQuestion,
  deps: ForkDeps,
): Promise<ForkAnswer | null> => {
  const passOn = passOnId(question.options);
  await context.hold?.wait("start", context.signal);
  if (context.signal.aborted) return null;
  const planned = forkSpec(context, owner, question, passOn, deps);
  if (planned === null) return null;
  const signal = AbortSignal.any([
    context.signal,
    AbortSignal.timeout(deps.timeoutMs ?? FORK_TIMEOUT_MS),
  ]);
  let outcome: SessionOutcome | null = null;
  try {
    const runtime = await deps.runtimeFor(planned.driver);
    const session = runtime.start(planned.spec, { human: NO_ONE });
    const stop = () => {
      void session.interrupt();
    };
    signal.addEventListener("abort", stop, { once: true });
    // A listener never hears an abort that has already happened.
    if (signal.aborted) stop();
    try {
      for await (const event of session.events) {
        if (event.type === "session.finished") {
          ({ outcome } = event);
          owner.charge(outcome.sessionId, outcome.usage);
        }
        owner.emit({ ...event, fork: true });
      }
    } finally {
      signal.removeEventListener("abort", stop);
    }
  } catch {
    return null;
  }
  // Cut off, its last word is no answer.
  if (signal.aborted) return null;
  return answerOf(outcome, [
    ...question.options.map(option => option.id),
    passOn,
  ]);
};

/** What the person sees of a question its asker's owner passed on. */
export const passedOnContext = (
  context: string | undefined,
  owner: string,
  note?: string,
): string =>
  [
    ...(context === undefined ? [] : [context, ""]),
    note === undefined
      ? `${owner} passed this on.`
      : `${owner} passed this on: ${note}`,
  ].join("\n");

/**
 * The node's channel to the person: what it asked is withdrawn when it stops,
 * so a stopped node leaves no decision open.
 */
export const withdrawnOnStop = (context: ExecuteContext): HumanChannel => {
  const { human } = context;
  const signalOf = (asked: AbortSignal | undefined): AbortSignal =>
    asked === undefined
      ? context.signal
      : AbortSignal.any([asked, context.signal]);
  return {
    permit: request =>
      human.permit({ ...request, signal: signalOf(request.signal) }),
    ask: question =>
      human.ask({ ...question, signal: signalOf(question.signal) }),
    ...(human.settled === undefined ? {} : { settled: human.settled }),
  };
};

/**
 * The child's channel when its owner takes its questions first: a question goes
 * to a fork of the owner's session, then to the person if the fork passes it on
 * or can't answer. Permission prompts go to the person as before.
 */
export const ownerFirst = (
  context: ExecuteContext,
  owner: OwnerPort,
  deps: ForkDeps,
): HumanChannel => {
  const human = withdrawnOnStop(context);
  return {
    permit: request => human.permit(request),
    ask: async question => {
      const answered = await askFork(context, owner, question, deps);
      // The node stopped while its leader was asked: no one else is.
      if (context.signal.aborted) {
        throw new Error(`${context.id} was stopped`);
      }
      if (answered === null) return human.ask(question);
      if (answered.choice === passOnId(question.options)) {
        return human.ask({
          ...question,
          owner: owner.id,
          context: passedOnContext(question.context, owner.id, answered.note),
        });
      }
      const { note } = answered;
      human.settled?.({
        ...question,
        answer: answered.choice,
        owner: owner.id,
        ...(note === undefined ? {} : { note }),
      });
      question.onOwner?.(owner.id);
      if (note !== undefined) question.onNote?.(note);
      return answered.choice;
    },
    ...(human.settled === undefined ? {} : { settled: human.settled }),
  };
};
