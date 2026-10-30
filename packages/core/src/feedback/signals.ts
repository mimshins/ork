/**
 * @file System signals (specs/feedback.md): feedback Ork derives from a run's
 *   own events, with no model call. A loop out of rounds, a budget that ran
 *   out, a tool the user denied, an Ork tool that failed, a gate that timed
 *   out, and an answer that differs from the recommended one each become a
 *   `feedback.recorded` event. The same observer fills in every record's origin
 *   (workflow, node type, model, driver, Ork version) and drops a run's
 *   duplicates.
 */

import type { RunEvent } from "../run/types.ts";
import { fingerprint } from "./fingerprint.ts";
import type {
  FeedbackKind,
  FeedbackOrigin,
  FeedbackSeverity,
  FeedbackTarget,
} from "./types.ts";

export type SignalOptions = {
  /** Ork's version. */
  version?: string;
  /** The workflow file's content hash. */
  workflowHash?: string;
};

type Signal = {
  code: string;
  kind: FeedbackKind;
  target: FeedbackTarget;
  severity: FeedbackSeverity;
  title: string;
  body: string;
  evidence?: string[];
};

type Asked = {
  node: string;
  kind: "question" | "permission";
  question: string;
  recommended?: string;
};

const ORK_TOOL = "mcp__ork__";

/**
 * An observer for one run's events: give it each event, and record what it
 * returns, in order (the event, its origin filled in when it is feedback, then
 * any feedback it signals).
 */
export const createSignals = (
  options: SignalOptions = {},
): ((event: RunEvent) => RunEvent[]) => {
  let workflow: string | undefined;
  const nodeTypes = new Map<string, string>();
  const sessions = new Map<string, { model: string; driver?: string }>();
  const tools = new Map<string, string>();
  const asked = new Map<string, Asked>();
  const seen = new Set<string>();

  const originOf = (node: string | undefined): FeedbackOrigin => {
    const origin: FeedbackOrigin = {};
    if (workflow !== undefined) origin.workflow = workflow;
    if (options.workflowHash !== undefined) {
      origin.workflowHash = options.workflowHash;
    }
    const type = node === undefined ? undefined : nodeTypes.get(node);
    if (type !== undefined) origin.nodeType = type;
    const session = node === undefined ? undefined : sessions.get(node);
    if (session !== undefined) origin.model = session.model;
    if (session?.driver !== undefined) origin.driver = session.driver;
    if (options.version !== undefined) origin.version = options.version;
    return origin;
  };

  const record = (node: string | undefined, signal: Signal): RunEvent[] => {
    const print = fingerprint(signal);
    if (seen.has(print)) return [];
    seen.add(print);
    return [
      {
        type: "feedback.recorded",
        ...(node === undefined ? {} : { node }),
        feedback: {
          source: "system",
          kind: signal.kind,
          target: signal.target,
          severity: signal.severity,
          title: signal.title,
          body: signal.body,
          evidence: signal.evidence ?? [],
          code: signal.code,
          fingerprint: print,
          origin: originOf(node),
        },
      },
    ];
  };

  const answered = (
    question: Asked,
    answer: string,
  ): [string, Signal] | null => {
    if (question.kind === "permission") {
      if (answer !== "deny") return null;
      const tool = question.question
        .replace(/^Allow /u, "")
        .replace(/\?$/u, "");
      return [
        question.node,
        {
          code: "permission.denied",
          kind: "friction",
          target: "workflow",
          severity: "low",
          title: `${question.node} was denied ${tool}`,
          body: "Allow it in the node's `tools.allow` if it needs it, or tell it in its prompt not to use it.",
          evidence: [tool],
        },
      ];
    }
    if (question.recommended === undefined || answer === question.recommended) {
      return null;
    }
    return [
      question.node,
      {
        code: "recommendation.overridden",
        kind: "context-gap",
        target: "workflow",
        severity: "low",
        title: `The answer to ${question.node}'s question was not the one it recommended`,
        body: `Asked: ${question.question} Recommended: ${question.recommended}. Answered: ${answer}.`,
      },
    ];
  };

  /** The feedback an event signals, if any, and the node it is about. */
  const signalOf = (event: RunEvent): [string | undefined, Signal] | null => {
    if (event.type === "loop.exhausted") {
      return [
        event.from,
        {
          code: "loop.exhausted",
          kind: "workflow",
          target: "workflow",
          severity: "medium",
          title: `The loop ${event.from} -> ${event.to} ran out of its ${String(event.maxRounds)} rounds`,
          body: "Raise `maxRounds`, or make what the loop's nodes are asked to fix clearer so it settles sooner.",
        },
      ];
    }
    if (
      event.type === "run.finished" &&
      event.result.status === "budget_exhausted"
    ) {
      return [
        undefined,
        {
          code: "budget.exhausted",
          kind: "workflow",
          target: "workflow",
          severity: "medium",
          title: "The run's budget ran out",
          body: `The run stopped after spending $${event.result.costUsd.toFixed(4)}. Raise \`limits.budgetUsd\`, or give nodes cheaper models or smaller budgets.`,
        },
      ];
    }
    if (event.type === "decision.answered") {
      const question = asked.get(event.decision);
      return question === undefined ? null : answered(question, event.answer);
    }
    if (event.type === "node.event" && event.event.type === "tool.result") {
      const name = tools.get(`${event.id}\0${event.event.id}`);
      if (!event.event.isError || name?.startsWith(ORK_TOOL) !== true) {
        return null;
      }
      const tool = name.slice(ORK_TOOL.length);
      return [
        event.id,
        {
          code: "tool.error",
          kind: "bug",
          target: "ork",
          severity: "medium",
          title: `Ork's ${tool} tool returned an error`,
          body: `A call to \`${tool}\` failed; the node's events show the call.`,
          evidence: [name],
        },
      ];
    }
    if (
      event.type === "node.finished" &&
      nodeTypes.get(event.id) === "human.gate" &&
      event.output["answeredBy"] === "timeout"
    ) {
      return [
        event.id,
        {
          code: "gate.timeout",
          kind: "workflow",
          target: "workflow",
          severity: "low",
          title: `The gate ${event.id} timed out and took its default`,
          body: "No one answered in time. Lengthen its `timeout`, or keep it if the default was right.",
        },
      ];
    }
    return null;
  };

  /** Keeps what later events and origins need. */
  const observe = (event: RunEvent): void => {
    if (event.type === "run.started") workflow = event.workflow;
    if (event.type === "node.started") nodeTypes.set(event.id, event.nodeType);
    if (event.type === "decision.opened") {
      const question: Asked = {
        node: event.node,
        kind: event.kind,
        question: event.question,
      };
      if (event.recommended !== undefined) {
        question.recommended = event.recommended;
      }
      asked.set(event.decision, question);
    }
    if (event.type !== "node.event") return;
    const inner = event.event;
    if (inner.type === "session.started") {
      sessions.set(event.id, {
        model: inner.model,
        ...(inner.driver === undefined ? {} : { driver: inner.driver }),
      });
    }
    if (inner.type === "tool.called") {
      tools.set(`${event.id}\0${inner.id}`, inner.name);
    }
  };

  return event => {
    observe(event);
    if (event.type === "feedback.recorded") {
      if (seen.has(event.feedback.fingerprint)) return [];
      seen.add(event.feedback.fingerprint);
      const origin = { ...originOf(event.node), ...event.feedback.origin };
      return [{ ...event, feedback: { ...event.feedback, origin } }];
    }
    const signal = signalOf(event);
    return signal === null ? [event] : [event, ...record(...signal)];
  };
};
