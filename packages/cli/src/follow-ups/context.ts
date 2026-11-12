/**
 * @file What `ork follow-ups` and a run share: the project's `followUps` rule,
 *   the sink a run hands its sessions' `follow_up` tool, the due check that
 *   runs before every call (a `gh` that fails only warns), and the follow-ups
 *   `ork run --follow-ups` takes as a run's brief.
 */

import {
  checkFollowUpsDue,
  deliverFollowUp,
  type EventStore,
  findFollowUp,
  type FollowUp,
  type FollowUpSink,
  type GhRunner,
  loadProject,
  placeFiles,
  type ProjectPlace,
  runGh,
  takeFollowUps,
} from "@krapht/ork-core";
import type { FollowUpsRule } from "@krapht/ork-schema";

/** The project's `followUps` rule, when it sets one. */
export const followUpsRule = (place: ProjectPlace): FollowUpsRule | undefined =>
  loadProject(place.root, placeFiles(place).rules).project?.followUps;

/** What a run hands its sessions: each `follow_up` call, kept as the rule says. */
export const followUpSink =
  (options: {
    store: EventStore;
    place: ProjectPlace;
    home?: string | undefined;
    gh?: GhRunner | undefined;
  }): FollowUpSink =>
  (input, at) => {
    const rule = followUpsRule(options.place);
    return deliverFollowUp(input, {
      store: options.store,
      project: options.place.root,
      worktree: at.cwd,
      ...(rule === undefined ? {} : { rule }),
      ...(options.home === undefined ? {} : { home: options.home }),
      ...(options.gh === undefined ? {} : { gh: options.gh }),
    });
  };

/** Gh's own words when it has no login. */
const SIGNED_OUT = /not logged in|gh auth login/iu;

/**
 * A gh error's first line, without a trailing period, so the notice is one
 * line.
 */
const oneLine = (error: string): string =>
  (error.trim().split("\n")[0] ?? "").trim().replace(/\.$/u, "");

/**
 * Moves the project's follow-ups whose time has come to due, as every `ork
 * follow-ups` call does first. `gh` failing only warns, through `warn`: one
 * line per call, however many refs failed.
 */
export const refreshDue = async (
  store: EventStore,
  project: string,
  warn: (line: string) => void,
  gh: GhRunner = runGh,
): Promise<FollowUp[]> => {
  try {
    const checked = await checkFollowUpsDue({ rows: store, project, gh });
    const [first] = checked.errors;
    if (first !== undefined) {
      warn(
        checked.errors.some(error => SIGNED_OUT.test(error))
          ? "Can't check PRs: `gh` isn't signed in. After-merge follow-ups stay waiting; run `gh auth login` yourself."
          : `Can't check PRs: ${oneLine(first)}. After-merge follow-ups stay waiting.`,
      );
    }
    return checked.due;
  } catch (error) {
    warn(
      `couldn't check what is due: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
};

/** The text a run starts from when it takes these follow-ups as its brief. */
export const briefOf = (followUps: readonly FollowUp[]): string =>
  [
    "Do these follow-ups left by earlier changes:",
    ...followUps.flatMap(f => [
      "",
      `## ${f.title} (${f.id})`,
      ...(f.body === "" ? [] : [f.body]),
      ...(f.where.length === 0 ? [] : [`Files: ${f.where.join(", ")}`]),
    ]),
  ].join("\n");

export type FollowUpsTaken =
  | { ok: true; followUps: FollowUp[] }
  | { ok: false; lines: string[] };

// Nothing is written: this only checks that a run could take them.
const nothing = (): void => {
  /* no-op */
};

/**
 * The follow-ups `ids` (or prefixes) name, when every one can be taken as a
 * brief; nothing is written, so a run that fails to start leaves them alone.
 */
export const checkTakeable = (
  store: EventStore,
  project: string,
  ids: readonly string[],
): FollowUpsTaken => {
  const full: string[] = [];
  const lines: string[] = [];
  for (const id of ids) {
    const found = findFollowUp(store, project, id);
    if (found.ok) full.push(found.followUp.id);
    else lines.push(found.error);
  }
  const { taken, refused } = takeFollowUps(
    {
      followUp: (p, id) => store.followUp(p, id),
      followUps: p => store.followUps(p),
      putFollowUp: nothing,
    },
    { project, run: "", ids: full },
  );
  const all = [...lines, ...refused];
  return all.length > 0
    ? { ok: false, lines: all.map(line => `--follow-ups: ${line}`) }
    : { ok: true, followUps: taken };
};
