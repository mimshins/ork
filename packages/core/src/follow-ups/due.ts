/**
 * @file When follow-ups come due. An `after-merge` one waits on its `ref` (a
 *   pull request or a branch), read through the person's own `gh`: merged, or
 *   the branch already in the base, makes it due; closed unmerged makes it due
 *   too, with a note saying so, never dropped. A dated one is due on its date;
 *   `after-deploy` only when someone says so (`markDue`). A run that publishes
 *   records its ref on the follow-ups it left (`recordPublished`), and the
 *   `agent` follow-ups it took as its brief are done.
 */

import { field, parseJson } from "@krapht/ork-integrations";

import type { GhRunner } from "../feedback/discussions.ts";
import type { FollowUpRows } from "../store/follow-ups.ts";
import type { FollowUp, FollowUpStatus } from "./types.ts";

export type RefState = "merged" | "closed" | "open";

export type RefRead =
  | { ok: true; state: RefState }
  | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

const why = (result: { stdout: string; stderr: string }): string =>
  result.stderr.trim() || result.stdout.trim() || "no output";

/**
 * Where `ref` stands, read in `cwd` with `gh`: a pull request by its URL,
 * number or head branch; else a branch, merged when the default branch holds
 * all of it (or it is the default branch).
 */
export const readRef = async (
  gh: GhRunner,
  cwd: string,
  ref: string,
): Promise<RefRead> => {
  const pr = await gh(["pr", "view", ref, "--json", "state"], { cwd });
  if (pr.ok) {
    const state = field(parseJson(pr.stdout), "state");
    if (state === "MERGED") return { ok: true, state: "merged" };
    return { ok: true, state: state === "CLOSED" ? "closed" : "open" };
  }
  const base = await gh(
    [
      "repo",
      "view",
      "--json",
      "defaultBranchRef",
      "--jq",
      ".defaultBranchRef.name",
    ],
    { cwd },
  );
  if (!base.ok) return { ok: false, error: `gh failed: ${why(base)}` };
  const name = base.stdout.trim();
  if (ref === name) return { ok: true, state: "merged" };
  const compared = await gh(
    ["api", `repos/{owner}/{repo}/compare/${name}...${ref}`, "--jq", ".status"],
    { cwd },
  );
  if (!compared.ok) {
    return { ok: false, error: `gh can't find ${ref}: ${why(compared)}` };
  }
  const status = compared.stdout.trim();
  return {
    ok: true,
    state: status === "identical" || status === "behind" ? "merged" : "open",
  };
};

const changed = (
  rows: FollowUpRows,
  f: FollowUp,
  patch: Partial<FollowUp> & { status?: FollowUpStatus },
  at: string,
): FollowUp => {
  const next = { ...f, ...patch, updatedAt: at };
  rows.putFollowUp(next);
  return next;
};

/** `YYYY-MM-DD` of `now`, in local time: the day a dated follow-up is due on. */
const dayOf = (now: Date): string =>
  [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

export type DueCheck = {
  /** Those that became due in this check. */
  due: FollowUp[];
  /** Refs `gh` couldn't read; their follow-ups wait. */
  errors: string[];
};

/** Moves a project's waiting follow-ups to `due` whose time has come. */
export const checkFollowUpsDue = async (options: {
  rows: FollowUpRows;
  /** The project root, absolute: where `gh` reads the refs. */
  project: string;
  gh: GhRunner;
  now?: () => Date;
}): Promise<DueCheck> => {
  const { rows, project, gh } = options;
  const now = options.now?.() ?? new Date();
  const at = now.toISOString();
  const today = dayOf(now);
  const reads = new Map<string, Promise<RefRead>>();
  const result: DueCheck = { due: [], errors: [] };
  const waiting = rows.followUps(project).filter(f => f.status === "waiting");
  for (const f of waiting) {
    if (DATE.test(f.due) && f.due <= today) {
      result.due.push(
        changed(rows, f, { status: "due", note: `due on ${f.due}` }, at),
      );
    }
  }
  const merging = waiting.filter(f => f.due === "after-merge");
  for (const f of merging) {
    if (f.ref === undefined) continue;
    const ref = f.ref;
    if (!reads.has(ref)) reads.set(ref, readRef(gh, project, ref));
  }
  for (const f of merging) {
    if (f.ref === undefined) continue;
    // oxlint-disable-next-line no-await-in-loop -- each ref is read once, already started above
    const read = await reads.get(f.ref);
    if (read === undefined) continue;
    if (!read.ok) {
      if (!result.errors.includes(read.error)) result.errors.push(read.error);
      continue;
    }
    if (read.state === "open") continue;
    // Read again: someone may have closed it while `gh` answered.
    const current = rows.followUp(project, f.id);
    if (current?.status !== "waiting") continue;
    const note =
      read.state === "merged"
        ? `${f.ref} merged`
        : `${f.ref} was closed without merging; decide whether it still applies`;
    result.due.push(changed(rows, current, { status: "due", note }, at));
  }
  return result;
};

/**
 * `ork follow-ups due <id|run>`: the waiting follow-up with that id, or every
 * waiting one that run left, made due now; empty when none matched.
 */
export const markDue = (
  rows: FollowUpRows,
  project: string,
  idOrRun: string,
  now: () => string = () => new Date().toISOString(),
): FollowUp[] => {
  const one = rows.followUp(project, idOrRun);
  const matched =
    one === undefined
      ? rows.followUps(project).filter(f => f.from.run === idOrRun)
      : [one];
  return matched
    .filter(f => f.status === "waiting")
    .map(f => changed(rows, f, { status: "due", note: "marked due" }, now()));
};

/**
 * A run published `ref`: the waiting follow-ups it left without a ref wait on
 * it now, and the `agent` follow-ups it or a run that called it (`callers`:
 * `ork run start` calling `build`) took as its brief are done.
 */
export const recordPublished = (
  rows: FollowUpRows,
  published: {
    project: string;
    run: string;
    ref: string;
    callers?: readonly string[];
  },
  now: () => string = () => new Date().toISOString(),
): { referenced: FollowUp[]; done: FollowUp[] } => {
  const { project, run, ref } = published;
  const takers = new Set([run, ...(published.callers ?? [])]);
  const all = rows.followUps(project);
  const referenced = all
    .filter(
      f => f.from.run === run && f.status === "waiting" && f.ref === undefined,
    )
    .map(f => changed(rows, f, { ref }, now()));
  const done = all
    .filter(
      f =>
        f.takenBy !== undefined &&
        takers.has(f.takenBy) &&
        (f.status === "waiting" || f.status === "due"),
    )
    .map(f =>
      changed(
        rows,
        f,
        { status: "done", note: `done by run ${run}, published as ${ref}` },
        now(),
      ),
    );
  return { referenced, done };
};

/**
 * `ork run start --follow-ups <ids>`: the open `agent` follow-ups among `ids`
 * become `run`'s brief; why each other id wasn't taken.
 */
export const takeFollowUps = (
  rows: FollowUpRows,
  taking: { project: string; run: string; ids: readonly string[] },
  now: () => string = () => new Date().toISOString(),
): { taken: FollowUp[]; refused: string[] } => {
  const taken: FollowUp[] = [];
  const refused: string[] = [];
  for (const id of taking.ids) {
    const f = rows.followUp(taking.project, id);
    if (f === undefined) refused.push(`${id}: there is no such follow-up`);
    else if (f.for !== "agent") refused.push(`${id}: it is for ${f.for}`);
    else if (f.status === "done" || f.status === "dropped") {
      refused.push(`${id}: it is ${f.status}`);
    } else taken.push(changed(rows, f, { takenBy: taking.run }, now()));
  }
  return { taken, refused };
};

/** Every ten minutes: a pull request's state changes slowly. */
export const FOLLOW_UP_CHECK_MS = 10 * 60 * 1000;

/**
 * Checks the projects' follow-ups now and on a schedule, while `ork ui` or `ork
 * watch` runs; `onDue` hears of those that came due (a notification). Returns
 * the stop. A check still going when the next is due is not doubled.
 */
export const startFollowUpChecks = (options: {
  rows: FollowUpRows;
  gh: GhRunner;
  /** The project roots to check, read at each check. */
  projects: () => readonly string[];
  onDue: (due: FollowUp[]) => void;
  onError?: (error: string) => void;
  everyMs?: number;
}): (() => void) => {
  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      for (const project of options.projects()) {
        // oxlint-disable-next-line no-await-in-loop -- one project at a time keeps gh calls few
        const result = await checkFollowUpsDue({
          rows: options.rows,
          project,
          gh: options.gh,
        });
        if (result.due.length > 0) options.onDue(result.due);
        for (const error of result.errors) options.onError?.(error);
      }
    } finally {
      busy = false;
    }
  };
  const run = (): void => {
    void tick().catch((error: unknown) => {
      options.onError?.(error instanceof Error ? error.message : String(error));
    });
  };
  run();
  const timer = setInterval(run, options.everyMs ?? FOLLOW_UP_CHECK_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
};
