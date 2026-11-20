/**
 * @file System signals (specs/feedback.md): feedback Ork derives from a run's
 *   own events, with no model call. A loop out of rounds, a budget that ran
 *   out, a tool the user denied, an Ork tool that failed, a report the `report`
 *   tool refused, a gate that timed out, a node that ended in a way its actor
 *   should act on (specs/runtime/session-ends.md), an answer that differs from
 *   the recommended one, and a shell rule allowed often across the project's
 *   runs each become a `feedback.recorded` event. The same observer fills in
 *   every record's origin (workflow, node type, model, driver, Ork version) and
 *   drops a run's duplicates.
 */

import type { RunEvent } from "../run/types.ts";
import { endOf } from "../runtime/ends-legacy.ts";
import { END_KINDS } from "../runtime/ends.ts";
import { maskSecrets } from "../store/mask.ts";
import {
  answeredSignal,
  type Asked,
  type PermissionHistory,
  suggestionSignals,
} from "./decision-signals.ts";
import { endSignal, type Signal } from "./end-signals.ts";
import { fingerprint } from "./fingerprint.ts";
import type { FeedbackOrigin } from "./types.ts";

export type SignalOptions = {
  /** Ork's version. */
  version?: string;
  /** The workflow file's content hash. */
  workflowHash?: string;
  /**
   * The run's env-value scrubber, applied to a tool's message after the
   * masking.
   */
  scrub?: (text: string) => string;
  /** The project's permission history; without it no rule is proposed. */
  permissions?: PermissionHistory;
};

const ORK_TOOL = "mcp__ork__";

/** The most characters of a tool's message kept as evidence. */
const MESSAGE_MAX = 300;

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

  /**
   * A tool's message as evidence: its first line, masked, then clipped (so a
   * cut never leaves half a secret).
   */
  const messageOf = (message: string | undefined): string[] => {
    const line = message?.split("\n", 1)[0]?.trim();
    if (line === undefined || line === "") return [];
    const clean = (options.scrub ?? ((text: string) => text))(
      maskSecrets(line),
    );
    return [clean.slice(0, MESSAGE_MAX)];
  };

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
      return question === undefined
        ? null
        : answeredSignal(question, event.answer);
    }
    if (event.type === "node.event" && event.event.type === "tool.result") {
      const name = tools.get(`${event.id}\0${event.event.id}`);
      if (!event.event.isError || name?.startsWith(ORK_TOOL) !== true) {
        return null;
      }
      const tool = name.slice(ORK_TOOL.length);
      // A report the tool refused is the agent's to fix, not Ork's bug.
      if (tool === "report") {
        return [
          event.id,
          {
            code: "report.rejected",
            kind: "context-gap",
            target: "workflow",
            severity: "low",
            title: `${event.id}'s report was not accepted`,
            body: END_KINDS.invalid_report.hint,
            evidence: [name],
          },
        ];
      }
      const evidence = [name, ...messageOf(event.event.message)];
      // Arguments the tool refused are the agent's mistake: Ork said what was wrong.
      // The title names the tool, not the node, so every node shares one item.
      if (event.event.fault === "arguments") {
        return [
          event.id,
          {
            code: "tool.arguments",
            kind: "context-gap",
            target: "workflow",
            severity: "low",
            title: `Ork's ${tool} tool refused a call's arguments`,
            body: `Nothing ran, and the tool said what was wrong. If it recurs, the node's prompt or context may need an example of a \`${tool}\` call.`,
            evidence,
          },
        ];
      }
      return [
        event.id,
        {
          code: "tool.error",
          kind: "bug",
          target: "ork",
          severity: "medium",
          title: `Ork's ${tool} tool returned an error`,
          body: `A call to \`${tool}\` failed; the node's events show the call.`,
          evidence,
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
    if (event.type === "node.finished" && !event.ok) {
      const signal = endSignal(event.id, endOf(event));
      return signal === null ? null : [event.id, signal];
    }
    return null;
  };

  /** Rules an allowed permission tips over the project's thresholds. */
  const suggestionsOf = (event: RunEvent): RunEvent[] =>
    event.type === "decision.answered"
      ? suggestionSignals(
          options.permissions,
          asked.get(event.decision),
          event.decision,
          event.answer,
        ).flatMap(signal => record(event.node, signal))
      : [];

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
    // A leader's fork is not its own session (ADR-063).
    if (inner.type === "session.started" && inner.fork !== true) {
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
    return [
      event,
      ...(signal === null ? [] : record(...signal)),
      ...suggestionsOf(event),
    ];
  };
};
