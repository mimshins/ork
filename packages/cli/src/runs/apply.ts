/**
 * @file `ork feedback apply` (ADR-059): runs Ork's own `ork:feedback-apply` in
 *   the project an item came from, with the item as its untrusted input. Its
 *   worker proposes a fix (on a branch, or uncommitted under `commit: never`)
 *   and its gate asks to keep or discard it; Ork never merges. Kept, the item
 *   is `resolved`, unless there is nothing to keep, or the uncommitted fix does
 *   not apply over the checkout: then, as when discarded, the item stays
 *   `accepted` (`keep.ts` says what happens to the worktree and branch).
 */

import {
  builtinProblem,
  builtinWorkflowFile,
  type EventStore,
  type FeedbackItem,
  type FeedbackRecord,
  feedbackActions,
  loadProject,
  openFixRun,
  ORK_DIR,
  placeFiles,
  placeOf,
  type ProjectPlace,
  type RunResult,
} from "@krapht/ork-core";

import { runWorkflowFile, type RunWorkflowOptions } from "../run/workflow.ts";
import { type commitsAhead, discardRun, keepRun } from "./keep.ts";

/** The most of an item's records the worker reads, newest first. */
const RECORDS = 10;

/** The most of a record's body the worker reads. */
const BODY_CHARS = 1500;

const BUILTIN = "ork:feedback-apply";

/**
 * What the worker is told under `knowledge: ork-only`; its edits are held to
 * it.
 */
const LIMIT_NOTE = `This project lets you write only under ${ORK_DIR}/ (workflows, skills, context). A Write or Edit of any other path is refused, and so is any file named CLAUDE.md or AGENTS.md, even under ${ORK_DIR}/. If the fix belongs outside ${ORK_DIR}/, change nothing and report fail with the reason.`;

const ATTACHED_REFUSAL =
  "This project sets `knowledge: ork-only`, which limits the fix to its Ork folder, but that folder is attached (under ~/.ork/projects/), outside the repository, and editing an attached Ork folder in place is not supported. Make the change by hand.";

/** Why apply refuses a project whose rules file can't be read. */
const brokenProject = (
  diagnostics: readonly { file?: string; line?: number; message: string }[],
): string =>
  [
    "The project's rules file can't be read, so whether it limits the fix (`knowledge`) is unknown. Fix it first:",
    ...diagnostics.map(
      d =>
        `${d.file ?? "project.yaml"}${d.line === undefined ? "" : `:${String(d.line)}`}: ${d.message}`,
    ),
  ].join("\n");

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
  | { kind: "kept"; branch: string; worktree: string; summary: string }
  | { kind: "discarded"; branch: string }
  | { kind: "nothing"; summary: string }
  | { kind: "unfinished"; reasons: string[] };

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * What a run of a built-in that proposes a change ended with:
 * `ork:feedback-apply` (worker `fix`), or `ork:onboard-write` (`write`). Both
 * end at a `keep` gate. The worker's `branch` is empty under `commit: never`,
 * where its change is uncommitted in its `worktree`.
 */
export const outcomeOf = (
  result: RunResult | null,
  worker = "fix",
): ApplyOutcome => {
  const node = (id: string) => result?.nodes.find(n => n.id === id);
  const fix = node(worker);
  const choice = text(node("keep")?.output?.["choice"]);
  const branch = text(fix?.output?.["branch"]);
  const worktree = text(fix?.output?.["worktree"]);
  const summary = text(fix?.output?.["summary"]);
  if (choice === "keep") return { kind: "kept", branch, worktree, summary };
  if (choice === "discard") return { kind: "discarded", branch };
  if (fix?.ok === false && result?.status === "failed") {
    return { kind: "nothing", summary: summary || (fix.error ?? "") };
  }
  return { kind: "unfinished", reasons: result?.reasons ?? [] };
};

export type ApplyOptions = Pick<
  RunWorkflowOptions,
  | "runtime"
  | "driverChecks"
  | "drivers"
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
      const kept = await keepRun(store, root, runId, outcome, options.ahead);
      switch (kept.kept) {
        case "none":
          return [
            `${outcome.branch === "" ? "the fix changed nothing" : "the fix's branch holds no commits"}, so there's nothing to keep; ${short} stays accepted`,
            ...kept.removed,
          ];
        case "refused":
          return [
            `the fix doesn't apply over this checkout's own changes (${kept.conflicts.join(", ") || kept.error}); ${short} stays accepted`,
            `Nothing changed here; the fix stays uncommitted in ${kept.worktree}.`,
          ];
        case "applied":
          store.setFeedbackStatus(item.id, "resolved");
          return [
            `kept the fix in this checkout, uncommitted (${kept.files.join(", ")}); ${short} is resolved`,
            "Review and commit it like any other change.",
            ...kept.removed,
          ];
        case "branch":
          store.setFeedbackStatus(item.id, "resolved");
          return [
            `kept the fix on ${outcome.branch}; ${short} is resolved`,
            "Review and merge it like any other change; Ork never merges it.",
          ];
        default:
          return kept satisfies never;
      }
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
  const loaded = loadProject(place.root, placeFiles(place).rules);
  // A broken project file could hide `knowledge: ork-only`: refuse, not guess.
  if (loaded.project === undefined && loaded.diagnostics.length > 0) {
    return { ok: false, error: brokenProject(loaded.diagnostics) };
  }
  const limited = loaded.project?.knowledge === "ork-only";
  if (limited && place.mode === "attached") {
    return { ok: false, error: ATTACHED_REFUSAL };
  }
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
    inputs: [
      `item=${short}`,
      `about=${aboutItem(item, records)}`,
      ...(limited ? [`limit=${LIMIT_NOTE}`] : []),
    ],
    untrusted: ["about"],
    ...(limited ? { writeOnly: [ORK_DIR] } : {}),
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
