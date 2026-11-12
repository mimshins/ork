/**
 * @file What `ork follow-ups` does to one follow-up: done (a message: sent),
 *   drop, reopen, make due, post a drafted GitHub comment, and `published`,
 *   which a workflow's step calls once its change is out. Posting goes through
 *   the person's own `gh` and only with `--confirm`, after showing the exact
 *   text; Ork never runs a task's commands.
 */

import { homedir } from "node:os";

import {
  changeFollowUp,
  findFollowUp,
  findRun,
  followUpActions,
  type FollowUpAction,
  markDue,
  postFollowUpMessage,
  recordPublished,
  runGh,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import {
  fail,
  idArg,
  inProject,
  project,
  withFollowUp,
} from "../follow-ups/command.ts";
import { plain, style, write } from "../output.ts";
import { withStore } from "../store.ts";

/** `done`, `drop` or `reopen`: one change of status, or why it can't be. */
export const closing = (
  action: FollowUpAction,
  description: string,
  verb: string,
) =>
  defineCommand({
    meta: { name: action, description },
    args: { id: idArg, project },
    run: ({ args }) =>
      withFollowUp(args, (store, _place, followUp) => {
        const changed = changeFollowUp(store, followUp, action);
        if (!changed.ok) {
          fail(changed.error);
          return;
        }
        write(
          `${style("green", "✓")} ${verb} ${changed.followUp.id}: ${plain(changed.followUp.title)}`,
        );
      }),
  });

export const due = defineCommand({
  meta: {
    name: "due",
    description:
      "Make a waiting follow-up due now, or all of a run's (after a deploy, say)",
  },
  args: {
    target: {
      type: "positional",
      description: "A follow-up's id (or a prefix), or a run id",
      required: true,
    },
    project,
  },
  run: ({ args }) =>
    inProject(args.project, (store, place) => {
      const one = findFollowUp(store, place.root, args.target);
      const run = findRun(store, args.target, "");
      const runId = run.ok ? run.run.id : args.target;
      const key = one.ok ? one.followUp.id : runId;
      const marked = markDue(store, place.root, key);
      if (marked.length === 0) {
        fail(
          `Nothing waiting under \`${args.target}\`: give a waiting follow-up's id, or a run that left some.`,
        );
        return;
      }
      for (const f of marked) {
        write(`${style("green", "✓")} due ${f.id}: ${plain(f.title)}`);
      }
    }),
});

export const post = defineCommand({
  meta: {
    name: "post",
    description:
      "Post a message drafted for GitHub, as a comment through your own gh, with --confirm; without it, show what would be posted",
  },
  args: {
    id: idArg,
    confirm: {
      type: "boolean",
      description: "Yes: post exactly this text",
      default: false,
    },
    project,
  },
  run: ({ args }) =>
    withFollowUp(args, async (store, _place, followUp) => {
      const allowed = followUpActions(followUp).post;
      if (!allowed.ok) {
        fail(allowed.error);
        return;
      }
      const draft = followUp.draft;
      if (!args.confirm && draft !== undefined) {
        write(`Would post to ${plain(draft.to)} through your gh:`);
        for (const line of draft.text.split("\n")) write(`  ${plain(line)}`);
        fail("Run again with --confirm to post it.");
        return;
      }
      const posted = await postFollowUpMessage(followUp, {
        rows: store,
        gh: runGh,
        confirmed: args.confirm,
        home: homedir(),
      });
      if (!posted.ok) {
        fail(posted.error);
        return;
      }
      write(
        `${style("green", "✓")} posted${posted.url === undefined ? "" : ` ${posted.url}`}; done ${followUp.id}`,
      );
    }),
});

export const published = defineCommand({
  meta: {
    name: "published",
    description:
      "Record that this run published a pull request or branch (a workflow step calls it): its follow-ups wait on it, and the ones it took are done",
  },
  args: {
    ref: {
      type: "positional",
      description: "The pull request URL or the branch",
      required: true,
    },
  },
  run: ({ args }) =>
    withStore(store => {
      const runId = process.env["ORK_RUN"];
      if (runId === undefined || runId === "") {
        fail("ork follow-ups published runs inside a run: ORK_RUN is not set.");
        return;
      }
      const found = findRun(store, runId, "");
      if (!found.ok) {
        fail(found.error);
        return;
      }
      // `ork run start --follow-ups` takes them in the run that called this one.
      const callers: string[] = [];
      for (
        let parent = found.run.parent;
        parent !== undefined && !callers.includes(parent);
        parent = store.lookup(parent).find(r => r.id === parent)?.parent
      ) {
        callers.push(parent);
      }
      const recorded = recordPublished(store, {
        project: found.run.project,
        run: found.run.id,
        ref: args.ref,
        callers,
      });
      write(
        `${style("green", "✓")} ${String(recorded.referenced.length)} follow-up(s) now wait on ${plain(args.ref)}; ${String(recorded.done.length)} done`,
      );
    }),
});
