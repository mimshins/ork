/**
 * @file `ork follow-ups`: what shipped changes left for later, apart from
 *   feedback (specs/follow-ups.md): list and show them, add one, and mark one
 *   done, dropped, reopened or due, or post its drafted GitHub comment (in
 *   `follow-ups-act.ts`). Every call first moves what has come due, reading
 *   pull requests through the person's own `gh`; a `gh` that fails only warns.
 */

import {
  applyFilters,
  followUpListTable,
  type FollowUpStatus,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import {
  idArg,
  inProjects,
  json,
  project,
  withFollowUp,
} from "../follow-ups/command.ts";
import {
  byFor,
  formatFollowUp,
  formatFollowUps,
} from "../follow-ups/format.ts";
import { allAlias } from "../list/all-alias.ts";
import { filterArgs, readListArgs } from "../list/flags.ts";
import { printList } from "../list/print.ts";
import { write } from "../output.ts";
import { closing, due, post, published } from "./follow-ups-act.ts";
import { add } from "./follow-ups-add.ts";

/** What a list with no `--status` shows. */
const OPEN: ReadonlySet<FollowUpStatus> = new Set(["due", "waiting"]);

/** The list's own order: due first, then waiting, done, dropped; then `byFor`. */
const RANK: Record<FollowUpStatus, number> = {
  due: 0,
  waiting: 1,
  done: 2,
  dropped: 3,
};

export const followUps = defineCommand({
  meta: {
    name: "follow-ups",
    description:
      "What shipped changes left for later: list, show, add, done, drop, reopen, due, post, published",
  },
  subCommands: {
    list: defineCommand({
      meta: {
        name: "list",
        description: "List the follow-ups, due first, then by who they are for",
      },
      args: { ...filterArgs(followUpListTable), ...allAlias },
      run: async ({ args }) => {
        const given: Readonly<Record<string, unknown>> = args;
        const asked = readListArgs(followUpListTable, given, { all: "status" });
        if (asked === undefined) return;
        const { filter, limit } = asked;
        // No --status shows only the open ones; one given shows what it names.
        const status = filter["status"];
        await inProjects(filter["project"], (store, places) => {
          const stored = places.flatMap(place => store.followUps(place.root));
          const shown = applyFilters(followUpListTable, stored, filter)
            .filter(f => status !== undefined || OPEN.has(f.status))
            .toSorted((a, b) => RANK[a.status] - RANK[b.status] || byFor(a, b))
            .slice(0, limit);
          printList(shown, followUpListTable, given, rows => {
            for (const line of formatFollowUps(rows, status !== undefined))
              write(line);
          });
        });
      },
    }),
    show: defineCommand({
      meta: {
        name: "show",
        description:
          "Show a follow-up whole, with its draft and its steps to copy",
      },
      args: { id: idArg, project, json },
      run: ({ args }) =>
        withFollowUp(args, (_store, _place, followUp) => {
          if (args.json) write(JSON.stringify(followUp, undefined, 2));
          else for (const line of formatFollowUp(followUp)) write(line);
        }),
    }),
    add,
    done: closing(
      "done",
      "Mark a follow-up done; a message is done once you have sent it",
      "done",
    ),
    drop: closing("drop", "Drop a follow-up that no longer applies", "dropped"),
    reopen: closing(
      "reopen",
      "Bring a done or dropped follow-up back",
      "reopened",
    ),
    due,
    post,
    published,
  },
});
