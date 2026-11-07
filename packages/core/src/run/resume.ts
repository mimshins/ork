/**
 * @file `ork resume`: what a stopped or crashed run's events say, read back
 *   (ADR-026). Each node's recorded results, in order, up to its first that
 *   failed or never finished, are handed back by the replay, so the scheduler
 *   rebuilds outputs, rounds, joins and loop counts without running them; the
 *   rest run again, and so does everything a new result feeds. Also: the run's
 *   inputs and settings, its worktrees, and the answers to its loops.
 */

import type { HumanChannel } from "../runtime/types.ts";
import { type EarlierSpend, earlierSpend } from "../usage/spend.ts";
import type { Mail } from "./bus-events.ts";
import type { Replay } from "./handle.ts";
import { mailOf } from "./mail.ts";
import type {
  Inputs,
  NodeOutput,
  NodeResult,
  RunEvent,
  RunSettings,
} from "./types.ts";

/** A worktree a run left: adopted when its folder is still there. */
export type RecordedWorktree = {
  id: string;
  path: string;
  branch?: string;
  /** The tree its own work is measured from (`merge: patch`). */
  snapshot?: string;
  /** Merged into its owner, with nothing after. */
  merged: boolean;
};

export type ResumeState = {
  /** Each node's results that can be handed back, in order. */
  history: Map<string, NodeResult[]>;
  inputs: Inputs;
  settings: RunSettings;
  worktrees: RecordedWorktree[];
  /** Every branch the run created, which it may check out again. */
  branches: string[];
  /** Answers to questions about loops out of rounds, in the order given. */
  loopAnswers: { question: string; answer: string }[];
  /** Whether the run ended as `succeeded`: nothing to resume. */
  succeeded: boolean;
  /**
   * The sessions nodes were cut off in when the run stopped, crashed or ran out
   * of budget; each continues there when it runs again.
   */
  cutOff: Map<string, string>;
  /** Unread messages and the user's queued ones, for the resumed bus. */
  mail: Mail;
  /** What the run has spent, which its budget and totals go on from. */
  earlier: EarlierSpend;
};

/** How a run ended that cut its working nodes off, rather than failing them. */
const CUTTING = new Set([
  "interrupted",
  "budget_exhausted",
  "quota_exhausted",
  "timed_out",
]);

type Open = { sessionId?: string };

/** Reads a run's events back into what `ork resume` needs. */
export const resumeState = (events: readonly RunEvent[]): ResumeState => {
  const history = new Map<string, NodeResult[]>();
  const closed = new Set<string>();
  const open = new Map<string, Open>();
  const worktrees = new Map<string, RecordedWorktree & { removed: boolean }>();
  const branches = new Set<string>();
  const loopAnswers: ResumeState["loopAnswers"] = [];
  /** Decision or owner-question id -> its question, when it is about a loop. */
  const loopQuestions = new Map<string, string>();
  let loopPending = false;
  let inputs: Inputs = {};
  let settings: RunSettings = {};
  let succeeded = false;
  let ended: string | undefined;
  /** Nodes whose last activation did not finish well, and its session. */
  const unfinished = new Map<string, string>();

  for (const event of events) {
    if (event.type === "run.started") {
      inputs = event.inputs ?? inputs;
      settings = event.settings ?? settings;
      continue;
    }
    if (event.type === "node.started") {
      // A delegated run belongs to its leader's session: never handed back.
      if (event.owner === undefined) open.set(event.id, {});
      continue;
    }
    if (event.type === "node.event") {
      const inner = event.event;
      const current = open.get(event.id);
      // A fork of a leader's session answered a question; it isn't the node's.
      if (current === undefined || inner.fork === true) {
        continue;
      }
      if (inner.type === "session.started") {
        current.sessionId = inner.sessionId;
      }
      if (inner.type === "session.finished" && inner.outcome.sessionId) {
        current.sessionId = inner.outcome.sessionId;
      }
      continue;
    }
    if (event.type === "node.finished") {
      const current = open.get(event.id);
      open.delete(event.id);
      if (current === undefined || closed.has(event.id)) continue;
      if (!event.ok) {
        closed.add(event.id);
        if (current.sessionId !== undefined) {
          unfinished.set(event.id, current.sessionId);
        }
        continue;
      }
      const result: NodeResult = { ok: true, output: event.output };
      if (event.usage !== undefined) result.usage = event.usage;
      if (current.sessionId !== undefined) {
        result.sessionId = current.sessionId;
      }
      history.set(event.id, [...(history.get(event.id) ?? []), result]);
      continue;
    }
    if (event.type === "worktree") {
      const known = worktrees.get(event.id);
      if (event.action === "created" || known === undefined) {
        worktrees.set(event.id, {
          id: event.id,
          path: event.path,
          ...(event.branch === undefined ? {} : { branch: event.branch }),
          merged: false,
          removed: false,
        });
      }
      const entry = worktrees.get(event.id);
      if (entry === undefined) continue;
      if (event.branch !== undefined) branches.add(event.branch);
      if (event.snapshot !== undefined) entry.snapshot = event.snapshot;
      if (event.action === "merged") entry.merged = true;
      if (event.action === "committed" || event.action === "conflict") {
        entry.merged = false;
      }
      if (event.action === "removed") entry.removed = true;
      continue;
    }
    if (event.type === "loop.exhausted") {
      loopPending = true;
      continue;
    }
    if (event.type === "decision.opened") {
      if (loopPending) loopQuestions.set(event.decision, event.question);
      loopPending = false;
      continue;
    }
    if (event.type === "owner.asked") {
      if (loopPending) loopQuestions.set(event.question, event.text);
      loopPending = false;
      continue;
    }
    if (event.type === "owner.unanswered") {
      // The same loop's question goes to the human next.
      loopPending = true;
      continue;
    }
    if (event.type === "decision.answered" || event.type === "owner.answered") {
      const key =
        event.type === "owner.answered" ? event.question : event.decision;
      const question = loopQuestions.get(key);
      if (question !== undefined) {
        loopAnswers.push({ question, answer: event.answer });
      }
      continue;
    }
    if (event.type === "run.finished") {
      succeeded = event.result.status === "succeeded";
      ended = event.result.status;
      continue;
    }
  }
  // A node still open never finished: it runs again, and nothing after it.
  for (const [id, current] of open) {
    closed.add(id);
    if (current.sessionId !== undefined) unfinished.set(id, current.sessionId);
  }
  const cut = ended === undefined || CUTTING.has(ended);

  return {
    history,
    inputs,
    settings,
    worktrees: [...worktrees.values()]
      .filter(w => !w.removed)
      .map(({ removed: _removed, ...w }) => w),
    branches: [...branches],
    loopAnswers,
    succeeded,
    cutOff: cut ? unfinished : new Map<string, string>(),
    mail: mailOf(events),
    earlier: earlierSpend(events),
  };
};

/** Whether an activation's input carries a result this run made anew. */
const carries = (fresh: WeakSet<object>, input: NodeOutput | undefined) => {
  if (input === undefined) return false;
  if (fresh.has(input)) return true;
  // A join's input holds each of its inputs' outputs.
  const results = input["results"];
  if (results === null || typeof results !== "object") return false;
  const values: unknown[] = Object.values(results);
  return values.some(
    value => value !== null && typeof value === "object" && fresh.has(value),
  );
};

/**
 * Hands each node's recorded results back in order, until the node runs anew
 * once (it failed or never finished last time, or its input is new); from then
 * on it always runs. A node cut off mid-session continues that session, once.
 */
export const createReplay = (
  history: ReadonlyMap<string, readonly NodeResult[]>,
  cutOff: ReadonlyMap<string, string> = new Map(),
  mail?: Mail,
  earlier?: EarlierSpend,
): Replay & { kept: () => string[] } => {
  const sessions = new Map(cutOff);
  const used = new Map<string, number>();
  const anew = new Set<string>();
  const fresh = new WeakSet<object>();
  return {
    take: activation => {
      const { id } = activation;
      if (activation.brief !== undefined || anew.has(id)) return null;
      const index = used.get(id) ?? 0;
      const recorded = history.get(id)?.[index];
      if (recorded === undefined || carries(fresh, activation.input)) {
        anew.add(id);
        return null;
      }
      used.set(id, index + 1);
      return recorded;
    },
    ran: result => {
      fresh.add(result.output);
    },
    cutOff: activation => {
      // A delegated run is its leader's: it never continues a cut session.
      const session =
        activation.brief === undefined
          ? sessions.get(activation.id)
          : undefined;
      sessions.delete(activation.id);
      return session;
    },
    kept: () => [...history.keys()],
    ...(mail === undefined ? {} : { mail }),
    ...(earlier === undefined ? {} : { earlier }),
  };
};

/**
 * The run's `HumanChannel`, answering questions about loops out of rounds as
 * they were answered last time, in order; anything else goes to `human`.
 */
export const replayLoopAnswers = (
  human: HumanChannel,
  answers: readonly { question: string; answer: string }[],
): HumanChannel => {
  const left = [...answers];
  return {
    permit: request => human.permit(request),
    ...(human.settled === undefined ? {} : { settled: human.settled }),
    ask: question => {
      const index = left.findIndex(a => a.question === question.question);
      const [given] = index === -1 ? [] : left.splice(index, 1);
      return given === undefined
        ? human.ask(question)
        : Promise.resolve(given.answer);
    },
  };
};
