/**
 * @file The decision queue: a `HumanChannel` that records every question and
 *   permission prompt as a decision in the store, then takes the first answer
 *   from the run's own terminal (when it has one) or from `ork decide` in any
 *   other terminal. A withdrawn question (a gate's timeout) is closed
 *   unanswered.
 */

import type { RunEvent } from "../run/types.ts";
import type { HumanChannel } from "../runtime/types.ts";
import type {
  AnsweredBy,
  DecisionRecord,
  DecisionStore,
  NewDecision,
} from "../store/types.ts";

export type DecisionQueueOptions = {
  store: DecisionStore;
  runId: string;
  /** The run's own terminal; none for a detached run. */
  local?: HumanChannel;
  emit: (event: RunEvent) => void;
  /** Resolves when the decision is no longer open; rejects when `signal` aborts. */
  waitFor: (id: string, signal: AbortSignal) => Promise<DecisionRecord>;
};

const PERMISSION_OPTIONS = [
  { id: "allow", label: "Allow" },
  { id: "deny", label: "Deny" },
];

const DENIED = "The user did not allow this tool.";

/** At most `max` characters of a tool's input, for the decision's context. */
const inputPreview = (input: Record<string, unknown>, max = 400): string => {
  const json = JSON.stringify(input);
  return json.length > max ? `${json.slice(0, max - 1)}…` : json;
};

export const createDecisionQueue = (
  options: DecisionQueueOptions,
): HumanChannel => {
  const { store, runId, emit } = options;
  let count = 0;

  /** Opens a decision and settles it with the first answer. */
  const decide = (
    open: Omit<NewDecision, "id" | "runId">,
    local: ((signal: AbortSignal) => Promise<string>) | undefined,
    withdrawn?: AbortSignal,
  ): Promise<{ answer: string; by: AnsweredBy }> => {
    count += 1;
    const id = `${runId}-${String(count)}`;
    const record = store.openDecision({ ...open, id, runId });
    const event: RunEvent = {
      type: "decision.opened",
      node: record.node,
      decision: id,
      kind: record.kind,
      question: record.question,
      options: record.options,
    };
    if (record.recommended !== undefined) {
      event.recommended = record.recommended;
    }
    emit(event);

    const { promise, resolve, reject } = Promise.withResolvers<{
      answer: string;
      by: AnsweredBy;
    }>();
    const settled = new AbortController();
    const finish = (answer: string, by: AnsweredBy): void => {
      if (settled.signal.aborted) return;
      settled.abort();
      emit({
        type: "decision.answered",
        node: open.node,
        decision: id,
        answer,
        by,
      });
      resolve({ answer, by });
    };
    const withdraw = (): void => {
      if (settled.signal.aborted) return;
      settled.abort();
      store.withdrawDecision(id);
      emit({ type: "decision.withdrawn", node: open.node, decision: id });
      reject(new Error("the question was withdrawn"));
    };
    if (withdrawn?.aborted === true) withdraw();
    withdrawn?.addEventListener("abort", withdraw, { once: true });

    const fromStore = async (): Promise<void> => {
      try {
        const closed = await options.waitFor(id, settled.signal);
        if (closed.status === "answered" && closed.answer !== undefined) {
          finish(closed.answer, closed.answeredBy ?? "decide");
        }
      } catch {
        // Settled another way.
      }
    };
    const fromTerminal = async (
      ask: (signal: AbortSignal) => Promise<string>,
    ): Promise<void> => {
      try {
        const answer = await ask(settled.signal);
        // Lost the race: `fromStore` delivers the answer that won.
        if (store.answerDecision(id, answer, "terminal")) {
          finish(answer, "terminal");
        }
      } catch {
        // Withdrawn: answered elsewhere, or the question was.
      }
    };
    void fromStore();
    if (local !== undefined) void fromTerminal(local);
    return promise;
  };

  return {
    ask: question => {
      const open: Omit<NewDecision, "id" | "runId"> = {
        node: question.nodeId,
        kind: "question",
        question: question.question,
        options: question.options,
      };
      if (question.recommended !== undefined) {
        open.recommended = question.recommended;
      }
      if (question.context !== undefined) open.context = question.context;
      const { local } = options;
      return decide(
        open,
        local === undefined
          ? undefined
          : signal => local.ask({ ...question, signal }),
        question.signal,
      ).then(({ answer }) => answer);
    },

    permit: async request => {
      const { local } = options;
      let localMessage = DENIED;
      const { answer } = await decide(
        {
          node: request.nodeId,
          kind: "permission",
          question: `Allow ${request.toolName}?`,
          options: PERMISSION_OPTIONS,
          context: inputPreview(request.input),
        },
        local === undefined
          ? undefined
          : signal =>
              local.permit({ ...request, signal }).then(result => {
                if (!result.allow) localMessage = result.message;
                return result.allow ? "allow" : "deny";
              }),
      );
      return answer === "allow"
        ? { allow: true }
        : { allow: false, message: localMessage };
    },
  };
};
