/**
 * @file `ork migrate` (ADR-036): moves an attached project's folder into its
 *   repository's `.ork/`, and with `--agents` brings the project's agents and
 *   skills under `.ork/` and points the tools' folders at them. It plans first,
 *   refusing on any clash or a live run, and commits nothing: the changes are
 *   left for the user to review and commit.
 */

import path from "node:path";

import {
  type AgentMigration,
  applySteps,
  type EventStore,
  inRepoPlace,
  liveStatus,
  openStore,
  placeFor,
  type MovePlan,
  type MoveStep,
  planAgentMigration,
  planMoveInto,
  type ProjectPlace,
  shownPath,
} from "@krapht/ork-core";

import { confirm, style, write, writeErr } from "../output.ts";
import { ignoreRunState, unignored } from "./init.ts";
import { formatLinks } from "./link.ts";

export type Migration = AgentMigration & {
  place: ProjectPlace;
  /** The `.gitignore` entries it adds. */
  ignore: string[];
};

/**
 * What migrating the project at `place` does: its attached folder moves into
 * `<root>/.ork` (then the project is in-repo), and with `agents`, the agents
 * and skills come under `.ork/`.
 */
export const planMigration = (
  place: ProjectPlace,
  options: { agents: boolean },
): Migration => {
  const plan: MovePlan = { steps: [], clashes: [] };
  const attached = place.mode === "attached";
  if (attached) {
    planMoveInto(place.dir, inRepoPlace(place.root).dir, plan);
    plan.steps.push({ kind: "prune", path: place.dir });
  }
  const migration = options.agents
    ? planAgentMigration(place.root, plan)
    : { ...plan, kept: [] };
  return { ...migration, place, ignore: attached ? unignored(place.root) : [] };
};

/** Why the project cannot migrate now, if it cannot. */
export const refusal = (
  migration: Migration,
  store: Pick<EventStore, "runs">,
): string | undefined => {
  if (migration.clashes.length > 0) {
    const shown = migration.clashes.map(c =>
      shownPath(c, migration.place.root),
    );
    return `These are already there, so nothing was moved: ${shown.join(", ")}. Move or remove them first.`;
  }
  const live = store
    .runs({ project: migration.place.root })
    .filter(run => liveStatus(run) === "running");
  if (live.length > 0) {
    return `Run ${live.map(r => r.id).join(", ")} is still running here; wait for it or stop it first.`;
  }
  return undefined;
};

/** Applies a planned migration and records where the project's files are. */
export const applyMigration = (
  migration: Migration,
  store: Pick<EventStore, "moveProject">,
): void => {
  const { place } = migration;
  applySteps(migration.steps);
  if (migration.ignore.length > 0) ignoreRunState(place.root);
  if (place.mode === "attached" && place.id !== undefined) {
    store.moveProject(place.id, inRepoPlace(place.root));
  }
};

const shown = (place: ProjectPlace, file: string) =>
  shownPath(file, place.root);

const stepLine = (place: ProjectPlace, step: MoveStep): string => {
  if (step.kind === "move") {
    return `move   ${shown(place, step.from)} → ${shown(place, step.to)}`;
  }
  if (step.kind === "link") {
    return `link   ${shown(place, step.at)} → ${path.relative(path.dirname(step.at), step.to)}`;
  }
  return `remove ${shown(place, step.path)} once it is empty`;
};

/** The plan, one line per step, then what is kept as it is. */
export const formatMigration = (migration: Migration): string[] => {
  const { place } = migration;
  const lines = migration.steps.map(step => stepLine(place, step));
  if (migration.ignore.length > 0) {
    lines.push(`ignore ${migration.ignore.join(", ")} in .gitignore`);
  }
  if (place.mode === "attached") {
    lines.push(`record ${place.id ?? "the project"} as in-repo`);
  }
  return [
    ...lines.map(line => `  ${line}`),
    ...formatLinks(migration.kept).map(line => `  ${line}`),
  ];
};

/** What to do once it is applied. */
export const afterMigration = (migration: Migration): string =>
  `Nothing is committed. Review it with ${style("bold", "git status")} in ${migration.place.root}, then commit .ork/ and the links yourself.`;

const fail = (message: string): void => {
  writeErr(message);
  process.exitCode = 1;
};

/** `ork migrate` in `cwd`: shows the plan, asks, and applies it. */
export const migrateHere = async (
  cwd: string,
  options: { agents: boolean; dryRun: boolean; yes: boolean },
): Promise<void> => {
  const store = openStore();
  try {
    const plan = planMigration(placeFor(cwd, store.projects()), options);
    const problem = refusal(plan, store);
    if (problem !== undefined) {
      fail(problem);
      return;
    }
    write(plan.steps.length === 0 ? "Nothing to migrate." : "Plan:");
    for (const line of formatMigration(plan)) write(line);
    if (plan.steps.length === 0 || options.dryRun) return;
    if (!options.yes && !process.stdin.isTTY) {
      fail("Pass --yes to migrate without a terminal.");
      return;
    }
    if (!options.yes && !(await confirm("Go ahead? [y/N] "))) return;
    applyMigration(plan, store);
    write(`${style("green", "✓")} migrated. ${afterMigration(plan)}`);
  } finally {
    store.close();
  }
};
