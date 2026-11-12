/**
 * @file Delivering a follow-up by who it is for. One for `project:<name>` goes
 *   into that registered project's follow-ups, through its own `followUps`
 *   rule, and, when a run of that project is live, to the running Claude node
 *   highest in that run's tree as an Ork notice (a row in the store and a wake
 *   on its socket, as the relay does). Every other one goes into this project's
 *   follow-ups: `agent` for a later run, `me` with its steps (never run),
 *   `person:<name>` with its draft (the maintainer sends it).
 */

import type { FollowUpsRule } from "@krapht/ork-schema";

import type { GhRunner } from "../feedback/discussions.ts";
import { placeFiles } from "../project/place.ts";
import { loadProject } from "../project/rules.ts";
import { flattenTree } from "../remote/commands.ts";
import { tellNode } from "../remote/links.ts";
import type { EventStore } from "../store/types.ts";
import { liveStatus, runTree } from "../store/view.ts";
import { followUpStore } from "./store.ts";
import type {
  FollowUp,
  FollowUpDelivered,
  FollowUpRelayed,
  NewFollowUp,
} from "./types.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const FOR = /^(?:agent|me|project:\S.*|person:\S.*)$/u;

/** Why `input` can't be kept, or `null`. */
export const followUpProblem = (input: NewFollowUp): string | null => {
  if (input.title.trim() === "") return "the title is empty";
  if (!FOR.test(input.for)) {
    return "`for` is agent, me, project:<name> or person:<name>";
  }
  const date =
    DATE.test(input.due) && !Number.isNaN(Date.parse(`${input.due}T00:00:00Z`));
  if (!["now", "after-merge", "after-deploy"].includes(input.due) && !date) {
    return "`due` is now, after-merge, after-deploy or a YYYY-MM-DD date";
  }
  if (input.kind === "message" && input.draft === undefined) {
    return "a message needs its `draft` (to, channel, text), which the maintainer sends";
  }
  if (input.steps?.some(step => step.text.trim() === "") === true) {
    return "each step needs its text";
  }
  return null;
};

/** The project a `project:<name>` follow-up is for, or `undefined`. */
const projectNamed = (input: NewFollowUp): string | undefined =>
  input.for.startsWith("project:")
    ? input.for.slice("project:".length).trim()
    : undefined;

/** What a live session is told of a follow-up for its project. */
export const relayText = (f: FollowUp, from: string): string =>
  [
    `[ork] A follow-up for this project from ${from} (${f.kind}, due ${f.due}, id ${f.id}): ${f.title}`,
    ...(f.body === "" ? [] : ["", f.body]),
    ...(f.where.length === 0 ? [] : ["", `Files: ${f.where.join(", ")}`]),
    "",
    "It is in this project's follow-ups; act on it only if it fits your task.",
  ].join("\n");

/**
 * The running Claude node highest in the newest live run of `project`'s tree,
 * first by start order; `undefined` when none runs.
 */
export const liveSessionOf = (
  store: EventStore,
  project: string,
): FollowUpRelayed | undefined => {
  for (const run of store.runs({ project })) {
    if (liveStatus(run) !== "running") continue;
    const nodes = flattenTree(
      runTree(store.events(run.id).map(stored => stored.event)),
    );
    const parents = new Map(nodes.map(n => [n.id, n.parent]));
    const depthOf = (id: string): number => {
      let depth = 0;
      for (let at = parents.get(id); at !== undefined; at = parents.get(at)) {
        depth += 1;
      }
      return depth;
    };
    // A stable sort keeps start order among nodes at the same depth.
    const node = nodes
      .filter(n => n.state === "running" && n.type.startsWith("agent."))
      .toSorted((a, b) => depthOf(a.id) - depthOf(b.id))
      .at(0);
    if (node !== undefined) return { run: run.id, node: node.id };
  }
  return undefined;
};

export type DeliverOptions = {
  store: EventStore;
  /** The project the follow-up comes from, absolute. */
  project: string;
  /** That project's `followUps` rule. */
  rule?: FollowUpsRule;
  /** The session's worktree, where a `file` store writes. */
  worktree?: string;
  /** The person's home folder: the redactor's and the sockets'. */
  home?: string;
  gh?: GhRunner;
  /** Sends the notice to a live run; default: a store row and a wake. */
  tell?: (to: FollowUpRelayed, text: string) => Promise<unknown>;
};

/** Keeps `input` where its `for` says, and relays it to a live run there. */
export const deliverFollowUp = async (
  input: NewFollowUp,
  options: DeliverOptions,
): Promise<FollowUpDelivered> => {
  const problem = followUpProblem(input);
  if (problem !== null) return { ok: false, error: problem };
  const { store, home } = options;
  const shared = {
    rows: store,
    ...(home === undefined ? {} : { home }),
    ...(options.gh === undefined ? {} : { gh: options.gh }),
  };
  const name = projectNamed(input);
  const target =
    name === undefined ? undefined : store.projects().find(p => p.id === name);
  if (name !== undefined && target === undefined) {
    const names = store.projects().map(p => p.id);
    return {
      ok: false,
      error: `there is no registered project \`${name}\`; registered: ${names.length === 0 ? "none" : names.join(", ")}`,
    };
  }
  if (target === undefined || target.root === options.project) {
    const added = await followUpStore({
      ...shared,
      project: options.project,
      ...(options.rule === undefined ? {} : { rule: options.rule }),
      ...(options.worktree === undefined ? {} : { worktree: options.worktree }),
    }).add(input);
    return { ok: true, added };
  }
  const rule = loadProject(target.root, placeFiles(target).rules).project
    ?.followUps;
  const added = await followUpStore({
    ...shared,
    project: target.root,
    ...(rule === undefined ? {} : { rule }),
  }).add(input);
  const live = liveSessionOf(store, target.root);
  if (live === undefined || added.merged) return { ok: true, added };
  const from =
    input.from?.run === undefined ? "the maintainer" : `run ${input.from.run}`;
  const text = relayText(added.followUp, from);
  const tell =
    options.tell ??
    ((to: FollowUpRelayed, body: string) => tellNode(store, to, body, home));
  try {
    await tell(live, text);
  } catch (error) {
    // It is kept; failing here would make a retry merge and skip the relay.
    const why = error instanceof Error ? error.message : String(error);
    const note = `It is in that project's list, but the live run there couldn't be told (${why}).`;
    return { ok: true, added: { ...added, note } };
  }
  return { ok: true, added, relayed: live };
};
