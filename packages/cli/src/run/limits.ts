/**
 * @file The limits across runs that apply here (RFC-007): the user's settings
 *   and the project's rules, read fresh for each command, and what a run does
 *   when one is spent.
 */

import {
  capsHere,
  type EventStore,
  limitsNow,
  limitsReport,
  NOT_STARTED,
  type ProjectPlace,
  type RunLimits,
} from "@krapht/ork-core";
import type { Workflow } from "@krapht/ork-schema";

type Store = Pick<EventStore, "spentSince" | "planLimits">;
type History = ReadonlyMap<string, readonly { ok: boolean }[]>;

/**
 * What a run started here is held to. The files are read each time, so a cap
 * changed during a run of hours reaches it; one that breaks meanwhile keeps the
 * last it could read.
 */
export const runLimits = (
  store: Store,
  place: ProjectPlace,
  home?: string,
): { problems: string[]; now: () => RunLimits } => {
  const first = capsHere(home, place);
  let { caps } = first;
  return {
    problems: first.problems,
    now: () => {
      const read = capsHere(home, place);
      if (read.problems.length === 0) ({ caps } = read);
      return limitsNow(store, caps, new Date());
    },
  };
};

/**
 * Whether what is left of a workflow can spend: a tool-only one, or a resume
 * with only tools to go, is not held back by a quota.
 */
const spendsAnything = (workflow: Workflow, history?: History): boolean =>
  Object.entries(workflow.nodes).some(
    ([id, node]) =>
      (node.type === "agent.leader" ||
        node.type === "agent.worker" ||
        node.type === "workflow.call") &&
      history?.get(id)?.at(-1)?.ok !== true,
  );

/** Why a run won't start: a settings file it can't read, or a spent limit. */
export const limitsRefusal = (
  limits: ReturnType<typeof runLimits>,
  workflow: Workflow,
  history?: History,
): string[] => {
  if (!spendsAnything(workflow, history)) return [];
  if (limits.problems.length > 0) return limits.problems;
  const { blocked } = limits.now();
  return blocked === undefined ? [] : [`${NOT_STARTED}${blocked}.`];
};

/** What `ork usage` shows. */
export const limitsHere = (
  store: Store,
  place: ProjectPlace | undefined,
  home?: string,
) => limitsReport(store, capsHere(home, place), new Date());

/** A line for `ork chat`, which counts and isn't stopped; `null` with no limit. */
export const chatNotice = (
  store: Store,
  place: ProjectPlace,
  home?: string,
): string | null => {
  const { blocked } = runLimits(store, place, home).now();
  return blocked === undefined
    ? null
    : `Note: ${blocked}. This chat counts towards it.`;
};
