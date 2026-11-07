/**
 * @file `ork feedback apply` (ADR-059): runs Ork's own `ork:feedback-apply` in
 *   the project an item came from, with the item as its untrusted input. Its
 *   worker proposes a fix on a branch and its gate asks to keep or discard it;
 *   Ork never merges. Kept, the item is `resolved`, unless its branch holds no
 *   new commits: then there is nothing to keep, and, as when discarded, the
 *   run's worktree and branch go and the item stays `accepted`.
 */

import {
  applyClean,
  builtinProblem,
  builtinWorkflowFile,
  createdWorktrees,
  type EventStore,
  type FeedbackItem,
  type FeedbackRecord,
  feedbackActions,
  listOrkWorktrees,
  openFixRun,
  placeOf,
  planClean,
  type ProjectPlace,
  type RunResult,
} from "@krapht/ork-core";

import { runWorkflowFile, type RunWorkflowOptions } from "../run/workflow.ts";

/** The most of an item's records the worker reads, newest first. */
const RECORDS = 10;

/** The most of a record's body the worker reads. */
const BODY_CHARS = 1500;

const BUILTIN = "ork:feedback-apply";

/** An item and its newest records, as the worker reads them. */
export const aboutItem = (
  item: FeedbackItem,
  records: readonly FeedbackRecord[],
): string => {
  const newest = records.toReversed().slice(0, RECORDS);
  const lines = [
    `Item ${item.id.slice(0, 12)}: ${item.title}`,
    `About: ${item.target} (${item.kind}), severity ${item.severity}; seen ${String(item.count)} time(s) in ${String(item.runs.length)} run(s).`,
  ];
  if (item.workflows.length > 0) {
    lines.push(`Workflows: ${item.workflows.join(", ")}`);
  }
  for (const record of newest) {
    const { feedback } = record;
    const where = record.node === undefined ? "" : `, node ${record.node}`;
    lines.push(
      "",
      `Record from run ${record.runId}${where} (${feedback.source}):`,
    );
    if (feedback.title !== item.title) lines.push(feedback.title);
    if (feedback.body !== "") lines.push(feedback.body.slice(0, BODY_CHARS));
    if (feedback.evidence.length > 0) {
      lines.push(`Evidence: ${feedback.evidence.join(", ")}`);
    }
  }
  if (records.length > newest.length) {
    lines.push(
      "",
      `(${String(records.length - newest.length)} older record(s) left out.)`,
    );
  }
  return lines.join("\n");
};

export type ApplyOutcome =
  | { kind: "kept"; branch: string; summary: string }
  | { kind: "discarded"; branch: string }
  | { kind: "nothing"; summary: string }
  | { kind: "unfinished"; reasons: string[] };

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** What a run of `ork:feedback-apply` ended with. */
export const outcomeOf = (result: RunResult | null): ApplyOutcome => {
  const node = (id: string) => result?.nodes.find(n => n.id === id);
  const fix = node("fix");
  const choice = text(node("keep")?.output?.["choice"]);
  const branch = text(fix?.output?.["branch"]);
  const summary = text(fix?.output?.["summary"]);
  if (choice === "keep") return { kind: "kept", branch, summary };
  if (choice === "discard") return { kind: "discarded", branch };
  if (fix?.ok === false && result?.status === "failed") {
    return { kind: "nothing", summary: summary || (fix.error ?? "") };
  }
  return { kind: "unfinished", reasons: result?.reasons ?? [] };
};

/**
 * Removes what a run left in the repository at `root`: its worktrees and
 * branches.
 */
export const discardRun = async (
  store: EventStore,
  root: string,
  runId: string,
): Promise<string[]> => {
  const items = await listOrkWorktrees(root, createdWorktrees(store, root));
  const steps = planClean(
    items,
    { merged: false, runId },
    { branches: true, force: true },
  );
  return applyClean(
    root,
    steps.filter(s => s.removeWorktree || s.deleteBranch),
    true,
  );
};

/** How many commits the run's worktrees hold that the current branch hasn't. */
export const commitsAhead = async (
  store: EventStore,
  root: string,
  runId: string,
): Promise<number> =>
  (await listOrkWorktrees(root, createdWorktrees(store, root)))
    .filter(item => item.runId === runId)
    .reduce((sum, item) => sum + item.ahead, 0);

export type ApplyOptions = Pick<
  RunWorkflowOptions,
  | "runtime"
  | "driverChecks"
  | "human"
  | "out"
  | "err"
  | "driver"
  | "home"
  | "onRun"
  | "runId"
> & {
  store: EventStore;
  item: FeedbackItem;
  registered: readonly ProjectPlace[];
  /** Counts the run's commits; tests pass their own. */
  ahead?: typeof commitsAhead;
};

export type Applied =
  | { ok: true; outcome: ApplyOutcome; lines: string[] }
  | { ok: false; error: string };

/** What to say, and the item's status, after the run ends as `outcome`. */
const settle = async (
  options: ApplyOptions,
  root: string,
  runId: string,
  outcome: ApplyOutcome,
): Promise<string[]> => {
  const { store, item } = options;
  const short = item.id.slice(0, 12);
  switch (outcome.kind) {
    case "kept": {
      const ahead = await (options.ahead ?? commitsAhead)(store, root, runId);
      if (ahead === 0) {
        const done = await discardRun(store, root, runId);
        return [
          `the fix's branch holds no commits, so there's nothing to keep; ${short} stays accepted`,
          ...done,
        ];
      }
      store.setFeedbackStatus(item.id, "resolved");
      return [
        `kept the fix on ${outcome.branch}; ${short} is resolved`,
        "Review and merge it like any other change; Ork never merges it.",
      ];
    }
    case "discarded": {
      const done = await discardRun(store, root, runId);
      return [`discarded the fix; ${short} stays accepted`, ...done];
    }
    case "nothing":
      return [
        `no fix proposed; ${short} stays accepted`,
        ...(outcome.summary === "" ? [] : [outcome.summary]),
      ];
    case "unfinished":
      return [
        `run ${runId} didn't finish, so ${short} stays as it was`,
        ...outcome.reasons,
      ];
    default:
      return outcome satisfies never;
  }
};

/** Proposes a fix for an item, in the project it came from. */
export const applyItem = async (options: ApplyOptions): Promise<Applied> => {
  const { store, item } = options;
  const short = item.id.slice(0, 12);
  const allowed = feedbackActions(item, openFixRun(store, item)).apply;
  if (!allowed.ok) return { ok: false, error: allowed.error };
  const found = placeOf(store, item, undefined, options.registered);
  if (!found.ok) return found;
  const { place, project } = found;
  const problem = builtinProblem(place, BUILTIN);
  const file = builtinWorkflowFile(place, BUILTIN);
  if (problem !== undefined || file === undefined) {
    return { ok: false, error: problem ?? `${BUILTIN} couldn't be written.` };
  }
  // Only what runs of this project recorded: a record from another project
  // could steer a worker here.
  const records = store
    .feedbackRecords(item.id)
    .filter(r => store.lookup(r.runId)[0]?.project === project);
  options.out(`▸ proposing a fix for ${short} in ${place.root}`);
  const { result } = await runWorkflowFile({
    ...options,
    file,
    cwd: place.root,
    inputs: [`item=${short}`, `about=${aboutItem(item, records)}`],
    untrusted: ["about"],
    inPlace: false,
    json: false,
    onRun: handle => {
      store.setFeedbackStatus(item.id, "accepted");
      options.onRun?.(handle);
    },
  });
  if (result === null) {
    return { ok: false, error: `${BUILTIN} didn't start.` };
  }
  const outcome = outcomeOf(result);
  return {
    ok: true,
    outcome,
    lines: await settle(options, place.root, result.runId, outcome),
  };
};
