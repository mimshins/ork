/**
 * @file A project's follow-ups through its `followUps` rule. Ork's store
 *   indexes every one, so they can be listed, come due and be closed in one
 *   place; the rule's place adapter (from `FOLLOW_UP_PLACES`) also writes a new
 *   one out: nowhere else (`store`), a markdown file (`file`) or a GitHub issue
 *   (`github`). Text is scrubbed with the feedback redactor first, and a
 *   follow-up for the same `for`, the same files and a near title merges into
 *   the open one already kept.
 */

import { randomBytes } from "node:crypto";
import { homedir } from "node:os";

import type { FollowUpPlace, FollowUpsRule } from "@krapht/ork-schema";

import { type GhRunner, runGh } from "../feedback/discussions.ts";
import { redact } from "../feedback/redact.ts";
import type { FollowUpRows } from "../store/follow-ups.ts";
import { fileFollowUps } from "./file.ts";
import { githubFollowUps } from "./github.ts";
import type {
  FollowUp,
  FollowUpFor,
  FollowUpKept,
  FollowUpPlaceAdapter,
  FollowUpStore,
  NewFollowUp,
} from "./types.ts";

const storeFollowUps: FollowUpPlaceAdapter = {
  place: "store",
  keep: () => Promise.resolve({ place: "store" }),
};

/** One adapter per `followUps.store` value. */
export const FOLLOW_UP_PLACES: Record<FollowUpPlace, FollowUpPlaceAdapter> = {
  store: storeFollowUps,
  file: fileFollowUps,
  github: githubFollowUps,
};

export const DEFAULT_FOLLOW_UPS_RULE: FollowUpsRule = { store: "store" };

/** How alike two titles' words must be to be the same follow-up. */
const NEAR_TITLE = 0.8;

const words = (title: string): Set<string> =>
  new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(word => word !== ""),
  );

/** Whether two titles share most of their words (Jaccard, `NEAR_TITLE`). */
export const nearTitle = (a: string, b: string): boolean => {
  const left = words(a);
  const right = words(b);
  const shared = [...left].filter(word => right.has(word)).length;
  const all = new Set([...left, ...right]).size;
  return all === 0 || shared / all >= NEAR_TITLE;
};

const sameFiles = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.toSorted().join("\n") === b.toSorted().join("\n");

/**
 * Whether `input` is `kept` again: still open, same `for`, files and a near
 * title.
 */
export const sameFollowUp = (
  kept: FollowUp,
  input: Pick<FollowUp, "for" | "where" | "title">,
): boolean =>
  (kept.status === "waiting" || kept.status === "due") &&
  kept.for === input.for &&
  sameFiles(kept.where, input.where) &&
  nearTitle(kept.title, input.title);

/** Who a follow-up is for, its name scrubbed and its kind kept. */
const scrubFor = (
  to: FollowUpFor,
  scrub: (text: string) => string,
): FollowUpFor => {
  if (to.startsWith("project:")) {
    return `project:${scrub(to.slice("project:".length))}`;
  }
  if (to.startsWith("person:")) {
    return `person:${scrub(to.slice("person:".length))}`;
  }
  return to;
};

/** `input` with what shouldn't be kept or leave the machine taken out. */
export const scrubFollowUp = (
  input: NewFollowUp,
  options: { roots: readonly string[]; home: string },
): NewFollowUp => {
  const scrub = (text: string): string => redact(text, options);
  return {
    ...input,
    for: scrubFor(input.for, scrub),
    title: scrub(input.title),
    ...(input.ref === undefined ? {} : { ref: scrub(input.ref) }),
    ...(input.body === undefined ? {} : { body: scrub(input.body) }),
    ...(input.where === undefined ? {} : { where: input.where.map(scrub) }),
    ...(input.draft === undefined
      ? {}
      : {
          draft: {
            ...input.draft,
            to: scrub(input.draft.to),
            text: scrub(input.draft.text),
            ...(input.draft.channel === undefined
              ? {}
              : { channel: scrub(input.draft.channel) }),
          },
        }),
    ...(input.steps === undefined
      ? {}
      : {
          steps: input.steps.map(step => ({
            text: scrub(step.text),
            ...(step.command === undefined
              ? {}
              : { command: scrub(step.command) }),
          })),
        }),
  };
};

/**
 * `kept` with `input` folded in: its body added, a missing draft or steps
 * taken.
 */
const mergedInto = (kept: FollowUp, input: NewFollowUp, at: string) => {
  const body = input.body ?? "";
  return {
    ...kept,
    body:
      body === "" || kept.body.includes(body)
        ? kept.body
        : [kept.body, body].filter(part => part !== "").join("\n\n"),
    ...(kept.draft === undefined && input.draft !== undefined
      ? { draft: input.draft }
      : {}),
    ...(kept.steps === undefined && input.steps !== undefined
      ? { steps: input.steps }
      : {}),
    updatedAt: at,
  };
};

export type FollowUpStoreOptions = {
  rows: FollowUpRows;
  /** The project root, absolute. */
  project: string;
  /** The project's `followUps` rule; default: Ork's store. */
  rule?: FollowUpsRule;
  /** The run's worktree, where a `file` is written; default: the project root. */
  worktree?: string;
  /** The person's home folder, for the redactor; default: `~`. */
  home?: string;
  /** Default: the person's `gh`. */
  gh?: GhRunner;
  now?: () => string;
  newId?: () => string;
};

/** The project's follow-ups through its rule. */
export const followUpStore = (options: FollowUpStoreOptions): FollowUpStore => {
  const { rows, project } = options;
  const rule = options.rule ?? DEFAULT_FOLLOW_UPS_RULE;
  const worktree = options.worktree ?? project;
  const home = options.home ?? homedir();
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? (() => randomBytes(4).toString("hex"));
  const adapter = FOLLOW_UP_PLACES[rule.store];
  const list: FollowUpStore["list"] = (filter = {}) =>
    rows
      .followUps(project)
      .filter(f => filter.status?.includes(f.status) ?? true);
  return {
    place: adapter.place,
    add: async raw => {
      const input = scrubFollowUp(raw, { roots: [project, worktree], home });
      const where = input.where ?? [];
      const at = now();
      const kept = list().find(f => sameFollowUp(f, { ...input, where }));
      if (kept !== undefined) {
        const merged = mergedInto(kept, input, at);
        rows.putFollowUp(merged);
        return { followUp: merged, merged: true };
      }
      const fresh: FollowUp = {
        id: newId(),
        project,
        title: input.title,
        body: input.body ?? "",
        for: input.for,
        kind: input.kind,
        due: input.due,
        where,
        from: input.from ?? {},
        status: input.due === "now" ? "due" : "waiting",
        ...(input.ref === undefined ? {} : { ref: input.ref }),
        ...(input.draft === undefined ? {} : { draft: input.draft }),
        ...(input.steps === undefined ? {} : { steps: input.steps }),
        place: "store",
        createdAt: at,
        updatedAt: at,
      };
      // Saved before the wait, so an add at the same time merges into it.
      rows.putFollowUp(fresh);
      let written: FollowUpKept;
      try {
        written = await adapter.keep(fresh, {
          project,
          worktree,
          rule,
          gh: options.gh ?? runGh,
        });
      } catch (error) {
        // Never lose it: Ork's store keeps it, and the person is told why.
        const why = error instanceof Error ? error.message : String(error);
        written = {
          place: "store",
          note: `It couldn't be written to ${rule.store} (${why}), so it is kept in Ork's store instead.`,
        };
      }
      const followUp: FollowUp = {
        // What a merge during the wait added stays.
        ...(rows.followUp(project, fresh.id) ?? fresh),
        place: written.place,
        ...(written.url === undefined ? {} : { url: written.url }),
      };
      rows.putFollowUp(followUp);
      return {
        followUp,
        merged: false,
        ...(written.note === undefined ? {} : { note: written.note }),
      };
    },
    list,
    get: id => rows.followUp(project, id),
    setStatus: (id, status, note) => {
      const kept = rows.followUp(project, id);
      if (kept === undefined) return kept;
      const { note: _old, ...rest } = kept;
      const changed: FollowUp = {
        ...rest,
        status,
        ...(note === undefined ? {} : { note }),
        updatedAt: now(),
      };
      rows.putFollowUp(changed);
      return changed;
    },
  };
};
