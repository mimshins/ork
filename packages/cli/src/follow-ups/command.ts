/**
 * @file What the `ork follow-ups` subcommands share: the flags, the project a
 *   call is about, and the due check every call runs first, in the user's
 *   store. A `gh` that fails only warns.
 */

import {
  ALL,
  type EventStore,
  findFollowUp,
  type FollowUp,
  placeFor,
  type ProjectPlace,
  unknownProjectRefusal,
} from "@krapht/ork-core";

import { style, writeErr } from "../output.ts";
import { withStore } from "../store.ts";
import { refreshDue } from "./context.ts";

export const json = {
  type: "boolean",
  description: "Print JSON",
  default: false,
} as const;

export const project = {
  type: "string",
  description: "A registered project's id (default: the one you are in)",
} as const;

export const idArg = {
  type: "positional",
  description: "A follow-up's id, or a prefix of one",
  required: true,
} as const;

/** Says why, and makes the command exit 1. */
export const fail = (message: string): void => {
  writeErr(message);
  process.exitCode = 1;
};

/** The project a command is about, from `--project` or the folder. */
const placeOf = (
  store: EventStore,
  key: string | undefined,
): ProjectPlace | undefined => {
  const projects = store.projects();
  if (key === undefined) return placeFor(process.cwd(), projects);
  const found = projects.find(p => p.id === key || p.root === key);
  if (found === undefined) {
    fail(
      unknownProjectRefusal(
        key,
        projects.map(p => p.id),
      ),
    );
    return undefined;
  }
  return placeFor(found.root, projects);
};

/** Runs `body` in the project, after the due check, in the user's store. */
export const inProject = (
  key: string | undefined,
  body: (store: EventStore, place: ProjectPlace) => Promise<void> | void,
): Promise<void> =>
  withStore(async store => {
    const place = placeOf(store, key);
    if (place === undefined) return;
    await refreshDue(store, place.root, line => {
      writeErr(style("dim", line));
    });
    await body(store, place);
  });

/**
 * Like `inProject`, for a list: `key` may be `all`, which gives every
 * registered project's place. The due check runs for each.
 */
export const inProjects = (
  key: string | undefined,
  body: (store: EventStore, places: ProjectPlace[]) => Promise<void> | void,
): Promise<void> =>
  withStore(async store => {
    const projects = store.projects();
    const places =
      key === ALL
        ? projects.map(p => placeFor(p.root, projects))
        : [placeOf(store, key)];
    if (places.includes(undefined)) return;
    const found = places.filter(place => place !== undefined);
    await Promise.all(
      found.map(place =>
        refreshDue(store, place.root, line => {
          writeErr(style("dim", line));
        }),
      ),
    );
    await body(store, found);
  });

/** Runs `body` on the follow-up `id` names, or says why there is none. */
export const withFollowUp = (
  args: { id: string; project?: string | undefined },
  body: (
    store: EventStore,
    place: ProjectPlace,
    followUp: FollowUp,
  ) => Promise<void> | void,
): Promise<void> =>
  inProject(args.project, async (store, place) => {
    const found = findFollowUp(store, place.root, args.id);
    if (!found.ok) {
      fail(found.error);
      return;
    }
    await body(store, place, found.followUp);
  });

/** What `eachTarget`'s `resolve` gives for one word: the follow-ups, or why not. */
export type Resolved =
  | { ok: true; followUps: FollowUp[] }
  | { ok: false; error: string };

/**
 * The follow-ups several words name (`done a b`, `drop a,b`: a comma splits a
 * word too), each once, or `undefined` after saying every word that failed and
 * making the command exit 1; the caller then changes nothing.
 */
export const eachTarget = (
  words: readonly string[],
  resolve: (word: string) => Resolved,
): FollowUp[] | undefined => {
  const named = [
    ...new Set(
      words
        .flatMap(word => word.split(","))
        .map(word => word.trim())
        .filter(word => word !== ""),
    ),
  ];
  if (named.length === 0) {
    fail("Give a follow-up id.");
    return undefined;
  }
  const found = new Map<string, FollowUp>();
  let failed = false;
  for (const word of named) {
    const one = resolve(word);
    if (one.ok) for (const f of one.followUps) found.set(f.id, f);
    else {
      fail(one.error);
      failed = true;
    }
  }
  return failed ? undefined : [...found.values()];
};

/**
 * Like `withFollowUp`, for every id in `args._` (space or comma separated):
 * `refused` says why one may not be changed, and any refusal stops the call.
 */
export const withFollowUps = (
  args: { _: string[]; project?: string | undefined },
  refused: (followUp: FollowUp) => string | undefined,
  body: (
    store: EventStore,
    place: ProjectPlace,
    followUps: FollowUp[],
  ) => Promise<void> | void,
): Promise<void> =>
  inProject(args.project, async (store, place) => {
    const followUps = eachTarget(args._, word => {
      const found = findFollowUp(store, place.root, word);
      if (!found.ok) return found;
      const why = refused(found.followUp);
      return why === undefined
        ? { ok: true, followUps: [found.followUp] }
        : { ok: false, error: why };
    });
    if (followUps !== undefined) await body(store, place, followUps);
  });
