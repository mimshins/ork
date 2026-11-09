/**
 * @file The decision queue: a `HumanChannel` that records every question and
 *   permission prompt as a decision in the store, then takes the first answer
 *   from the run's own terminal (when it has one) or from `ork decide` in any
 *   other terminal. An answer may carry the person's note, which is stored with
 *   it and handed to whoever asked. A withdrawn question (a gate's timeout) is
 *   closed unanswered. A child's question its leader answered first is recorded
 *   as answered by that owner, with its note (ADR-063). A resumed run's ids go
 *   on from the ones stored, and what its last process left open is withdrawn.
 */

import type { RunEvent } from "../run/types.ts";
import type { HumanChannel } from "../runtime/types.ts";
import { maskSecrets } from "../store/mask.ts";
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

/** What came back: the choice, who gave it, and their note if any. */
type Settled = { answer: string; by: AnsweredBy; note?: string };

/** The terminal's side of a decision: its choice, and its note if any. */
type LocalAnswer = { answer: string; note?: string };

/** The deny message a session gets, with the person's words when given. */
const deniedMessage = (note: string | undefined): string =>
  note === undefined ? DENIED : `${DENIED} They said: ${note}`;

/** The input fields that say what a tool will do, the first one present. */
export const TOOL_INPUT_KEYS = [
  "command",
  "file_path",
  "path",
  "url",
  "pattern",
] as const;

/** A tool's input for the decision's context: as written, cut at `max`. */
const inputContext = (input: Record<string, unknown>, max = 4000): string => {
  const key = TOOL_INPUT_KEYS.find(k => typeof input[k] === "string");
  const text =
    key === undefined
      ? JSON.stringify(input, undefined, 2)
      : String(input[key]);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export const createDecisionQueue = (
  options: DecisionQueueOptions,
): HumanChannel => {
  const { store, runId, emit } = options;
  // One process per run: a stored decision is an earlier process's, on resume.
  const earlier = store.decisions({ runId });
  let count = Math.max(
    0,
    ...earlier.map(({ id }) => Number(id.slice(runId.length + 1)) || 0),
  );
  // Nobody waits on these any more: the session that asked will ask again.
  for (const { id, node, status } of earlier) {
    if (status !== "open") continue;
    store.withdrawDecision(id);
    emit({ type: "decision.withdrawn", node, decision: id });
  }

  /** Opens a decision and settles it with the first answer. */
  const decide = (
    open: Omit<NewDecision, "id" | "runId">,
    local: ((signal: AbortSignal) => Promise<LocalAnswer>) | undefined,
    withdrawn?: AbortSignal,
  ): Promise<Settled> => {
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
    if (record.owner !== undefined) event.owner = record.owner;
    emit(event);

    const { promise, resolve, reject } = Promise.withResolvers<Settled>();
    const settled = new AbortController();
    /** `note` is the stored one: masked, and absent when blank. */
    const finish = (answer: string, by: AnsweredBy, note?: string): void => {
      if (settled.signal.aborted) return;
      settled.abort();
      const answered: RunEvent = {
        type: "decision.answered",
        node: open.node,
        decision: id,
        answer,
        by,
      };
      if (note !== undefined) answered.note = note;
      emit(answered);
      resolve(note === undefined ? { answer, by } : { answer, by, note });
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
          finish(closed.answer, closed.answeredBy ?? "decide", closed.note);
        }
      } catch {
        // Settled another way.
      }
    };
    const fromTerminal = async (
      ask: (signal: AbortSignal) => Promise<LocalAnswer>,
    ): Promise<void> => {
      try {
        const { answer, note } = await ask(settled.signal);
        // Lost the race: `fromStore` delivers the answer that won.
        if (store.answerDecision(id, answer, "terminal", note)) {
          finish(answer, "terminal", store.decision(id)?.note);
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
      if (question.document !== undefined) open.document = question.document;
      // A leader passed it on, its note in the context (ADR-063).
      if (question.owner !== undefined) open.owner = question.owner;
      const { local } = options;
      return decide(
        open,
        local === undefined
          ? undefined
          : signal => {
              let note: string | undefined;
              return local
                .ask({
                  ...question,
                  // The terminal shows what the store holds, masked.
                  question: maskSecrets(question.question),
                  ...(question.context === undefined
                    ? {}
                    : { context: maskSecrets(question.context) }),
                  ...(question.document === undefined
                    ? {}
                    : { document: maskSecrets(question.document) }),
                  signal,
                  onNote: given => {
                    note = given;
                  },
                })
                .then(answer =>
                  note === undefined ? { answer } : { answer, note },
                );
            },
        question.signal,
      ).then(({ answer, note }) => {
        if (note !== undefined) question.onNote?.(note);
        return answer;
      });
    },

    settled: question => {
      count += 1;
      const id = `${runId}-${String(count)}`;
      const { owner } = question;
      const record = store.openDecision({
        id,
        runId,
        node: question.nodeId,
        kind: "question",
        question: question.question,
        options: question.options,
        owner,
        ...(question.recommended === undefined
          ? {}
          : { recommended: question.recommended }),
        ...(question.context === undefined
          ? {}
          : { context: question.context }),
      });
      emit({
        type: "decision.opened",
        node: record.node,
        decision: id,
        kind: "question",
        question: record.question,
        options: record.options,
        owner,
        ...(record.recommended === undefined
          ? {}
          : { recommended: record.recommended }),
      });
      store.answerDecision(id, question.answer, "owner", question.note);
      const note = store.decision(id)?.note;
      emit({
        type: "decision.answered",
        node: record.node,
        decision: id,
        answer: question.answer,
        by: "owner",
        owner,
        ...(note === undefined ? {} : { note }),
      });
    },

    permit: async request => {
      const { local } = options;
      let localMessage = DENIED;
      const { answer, note } = await decide(
        {
          node: request.nodeId,
          kind: "permission",
          question: `Allow ${request.toolName}?`,
          options: PERMISSION_OPTIONS,
          context: inputContext(request.input),
        },
        local === undefined
          ? undefined
          : signal => {
              let said: string | undefined;
              return local
                .permit({
                  ...request,
                  signal,
                  onNote: given => {
                    said = given;
                  },
                })
                .then(result => {
                  if (!result.allow) localMessage = result.message;
                  const choice = result.allow ? "allow" : "deny";
                  return said === undefined
                    ? { answer: choice }
                    : { answer: choice, note: said };
                });
            },
        request.signal,
      );
      if (note !== undefined) request.onNote?.(note);
      return answer === "allow"
        ? { allow: true }
        : {
            allow: false,
            message: note === undefined ? localMessage : deniedMessage(note),
          };
    },
  };
};
