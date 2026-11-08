/**
 * @file `ork resume`: what a stopped or crashed run's events say, read back
 *   (ADR-026). Each node's recorded results, in order, up to its first that
 *   failed or never finished, are handed back by the replay, so the scheduler
 *   rebuilds outputs, rounds, joins and loop counts without running them; the
 *   rest run again, and so does everything a new result feeds. Also: the run's
 *   inputs and settings, its worktrees, the answers to its loops, and a fanned
 *   node's lists and its items' results by round (RFC-013). `replay.ts` hands
 *   them back.
 */

import { type EarlierSpend, earlierSpend } from "../usage/spend.ts";
import type { Mail } from "./bus-events.ts";
import { mailOf } from "./mail.ts";
import type { Inputs, NodeResult, RunEvent, RunSettings } from "./types.ts";

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

/** What a fanned node's activations recorded (RFC-013). */
export type RecordedFanOuts = {
  /** Each `each.listed` list, by node and round; the latest wins. */
  lists: Map<string, unknown[]>;
  /** Each item's results, by item id and its node's round. */
  items: Map<string, Map<number, NodeResult>>;
};

export const listKey = (node: string, round: number): string =>
  `${node}/${String(round)}`;

export type ResumeState = {
  /** Each node's results that can be handed back, in order; not items'. */
  history: Map<string, NodeResult[]>;
  fanOuts: RecordedFanOuts;
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

type Open = { sessionId?: string; item?: true };

/** Reads a run's events back into what `ork resume` needs. */
export const resumeState = (events: readonly RunEvent[]): ResumeState => {
  const history = new Map<string, NodeResult[]>();
  const fanOuts: RecordedFanOuts = { lists: new Map(), items: new Map() };
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
      if (event.owner === undefined) {
        open.set(event.id, event.item === undefined ? {} : { item: true });
      }
      continue;
    }
    if (event.type === "each.listed") {
      fanOuts.lists.set(listKey(event.node, event.round), event.list);
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
      if (current.item === true) {
        const rounds =
          fanOuts.items.get(event.id) ?? new Map<number, NodeResult>();
        fanOuts.items.set(event.id, rounds.set(event.round, result));
      } else {
        history.set(event.id, [...(history.get(event.id) ?? []), result]);
      }
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
    if (event.type === "loop.exhausted" || event.type === "each.exceeded") {
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
    fanOuts,
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
