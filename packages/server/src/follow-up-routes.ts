/**
 * @file The follow-ups' routes (specs/follow-ups.md), through the same core
 *   functions as `ork follow-ups`: a project's list (after the due check, which
 *   reads pull requests through the person's own `gh` and only reports a `gh`
 *   that fails), one follow-up with what to copy and what can be done to it,
 *   done, drop, reopen and due, and posting a drafted GitHub comment only with
 *   the person's confirmation of the draft they saw (its digest). Ork never
 *   runs a task's commands.
 */

import { createHash } from "node:crypto";
import { homedir } from "node:os";

import {
  changeFollowUp,
  checkFollowUpsDue,
  DEFAULT_FOLLOW_UPS_RULE,
  dueCause,
  type EventStore,
  findFollowUp,
  type FollowUp,
  followUpActions,
  liveSessionOf,
  loadProject,
  placeFiles,
  postFollowUpMessage,
  runGh,
} from "@krapht/ork-core";
import type { FollowUpPlace } from "@krapht/ork-schema";

import { projectOf, type ServerContext } from "./context.ts";
import type {
  FollowUpDelivery,
  FollowUpDetail,
  FollowUpDueItem,
  FollowUpsDue,
} from "./contract-follow-ups.ts";
import { fail, type Handlers, ok } from "./router.ts";

type FollowUpRoutes = Pick<
  Handlers,
  "followUps" | "followUp" | "followUpChange" | "followUpPost"
>;

const OPEN = ["due", "waiting"] as const;

/** Stands for what a person saw of a draft: its recipient and text. */
export const digestOf = (f: FollowUp): string | undefined =>
  f.draft === undefined
    ? undefined
    : createHash("sha256")
        .update(JSON.stringify([f.draft.to, f.draft.text]))
        .digest("hex");

/** The place a project's rule keeps follow-ups in. */
const ruleOf = (
  project: ReturnType<typeof projectOf> & object,
): FollowUpPlace =>
  (
    loadProject(project.root, placeFiles(project).rules).project?.followUps ??
    DEFAULT_FOLLOW_UPS_RULE
  ).store;

/** Why a follow-up isn't where the project's rule says, when it isn't. */
const fallbackOf = (
  placed: FollowUpPlace,
  rule: FollowUpPlace,
): string | undefined => {
  if (placed === rule) return undefined;
  return rule === "github"
    ? "GitHub couldn't be used when it was added (gh not signed in, or the issue failed), so Ork's store keeps it."
    : `It couldn't be written to ${rule} when it was added, so Ork's store keeps it.`;
};

const deliveryOf = (
  store: EventStore,
  f: FollowUp,
): FollowUpDelivery | undefined => {
  if (!f.for.startsWith("project:")) return undefined;
  const name = f.for.slice("project:".length).trim();
  const target = store.projects().find(p => p.id === name);
  if (target === undefined) return { project: name, registered: false };
  const live = liveSessionOf(store, target.root);
  return {
    project: name,
    registered: true,
    root: target.root,
    keptIn: ruleOf(target),
    ...(live === undefined ? {} : { live }),
  };
};

/** `f`, what can be done to it, where it is kept, and what to copy from it. */
export const detailOf = (
  context: ServerContext,
  project: NonNullable<ReturnType<typeof projectOf>>,
  f: FollowUp,
): FollowUpDetail => {
  const rule = ruleOf(project);
  const fallback = fallbackOf(f.place, rule);
  const cause = dueCause(f);
  const delivery = deliveryOf(context.store, f);
  const digest = digestOf(f);
  return {
    followUp: f,
    actions: followUpActions(f),
    ...(cause === undefined ? {} : { cause }),
    keptIn: {
      place: f.place,
      rule,
      ...(f.url === undefined ? {} : { url: f.url }),
      ...(fallback === undefined ? {} : { fallback }),
    },
    ...(delivery === undefined ? {} : { delivery }),
    ...(digest === undefined ? {} : { draftDigest: digest }),
    copy: {
      text: f.draft?.text ?? "",
      commands: (f.steps ?? []).flatMap(step =>
        step.command === undefined ? [] : [step.command],
      ),
    },
  };
};

const toItem = (f: FollowUp): FollowUpDueItem => ({
  id: f.id,
  project: f.project,
  title: f.title,
  for: f.for,
  kind: f.kind,
  ...(f.note === undefined ? {} : { note: f.note }),
});

/** The due follow-ups of `roots`, most recently changed first. */
export const dueOf = (
  store: EventStore,
  roots: readonly string[],
): FollowUpsDue => {
  const due = roots
    .flatMap(root => store.followUps(root))
    .filter(f => f.status === "due")
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { count: due.length, items: due.slice(0, 20).map(f => toItem(f)) };
};

type Refusal = { status: 400 | 404 | 409; error: string };

type Found =
  | {
      ok: true;
      project: NonNullable<ReturnType<typeof projectOf>>;
      followUp?: FollowUp;
    }
  | { ok: false; refusal: Refusal };

const found = (
  context: ServerContext,
  params: { id: string; followUp?: string },
): Found => {
  const project = projectOf(context, params.id);
  if (project === undefined) {
    return {
      ok: false,
      refusal: fail(404, `No registered project \`${params.id}\`.`),
    };
  }
  if (params.followUp === undefined) return { ok: true, project };
  const one = findFollowUp(context.store, project.root, params.followUp);
  if (!one.ok) {
    const status = one.error.startsWith("No follow-up") ? 404 : 400;
    return { ok: false, refusal: fail(status, one.error) };
  }
  return { ok: true, project, followUp: one.followUp };
};

export const followUpRoutes = (context: ServerContext): FollowUpRoutes => {
  const { store } = context;
  const gh = context.gh ?? runGh;
  return {
    followUps: async ({ params, query }) => {
      const one = found(context, params);
      if (!one.ok) return one.refusal;
      const { root } = one.project;
      const errors = await checkFollowUpsDue({ rows: store, project: root, gh })
        .then(checked => checked.errors)
        .catch((error: unknown) => [
          error instanceof Error ? error.message : String(error),
        ]);
      const all = store.followUps(root);
      const status = query.status ?? "open";
      const shown = all.filter(f => {
        if (query.for !== undefined && f.for !== query.for) return false;
        if (status === "all") return true;
        if (status === "open") return OPEN.some(s => s === f.status);
        return f.status === status;
      });
      return ok({
        project: root,
        followUps: shown,
        due: all.filter(f => f.status === "due").length,
        checker: { available: errors.length === 0, errors },
      });
    },

    followUp: ({ params }) => {
      const one = found(context, params);
      if (!one.ok) return one.refusal;
      return one.followUp === undefined
        ? fail(404, "No such follow-up.")
        : ok(detailOf(context, one.project, one.followUp));
    },

    followUpChange: ({ params, body }) => {
      const one = found(context, params);
      if (!one.ok) return one.refusal;
      if (one.followUp === undefined) return fail(404, "No such follow-up.");
      const changed = changeFollowUp(store, one.followUp, body.action);
      return changed.ok
        ? ok(detailOf(context, one.project, changed.followUp))
        : fail(409, changed.error);
    },

    followUpPost: async ({ params, body }) => {
      const one = found(context, params);
      if (!one.ok) return one.refusal;
      const { followUp } = one;
      if (followUp === undefined) return fail(404, "No such follow-up.");
      const check = followUpActions(followUp).post;
      if (!check.ok) return fail(409, check.error);
      if (digestOf(followUp) !== body.digest) {
        return fail(
          409,
          "The draft is no longer the one you confirmed; open the follow-up again.",
        );
      }
      const posted = await postFollowUpMessage(followUp, {
        rows: store,
        gh,
        confirmed: body.confirm,
        home: context.home ?? homedir(),
      });
      return posted.ok
        ? ok({
            ...(posted.url === undefined ? {} : { url: posted.url }),
            followUp: detailOf(context, one.project, posted.followUp),
          })
        : fail(409, posted.error);
    },
  };
};
