/**
 * @file `ork follow-ups`: what shipped changes left for later, apart from
 *   feedback (specs/follow-ups.md): list and show them, add one, and mark one
 *   done, dropped, reopened or due, or post its drafted GitHub comment (in
 *   `follow-ups-act.ts`). Every call first moves what has come due, reading
 *   pull requests through the person's own `gh`; a `gh` that fails only warns.
 */

import { defineCommand } from "citty";

import {
  idArg,
  inProject,
  json,
  project,
  withFollowUp,
} from "../follow-ups/command.ts";
import { formatFollowUp, formatFollowUps } from "../follow-ups/format.ts";
import { write } from "../output.ts";
import { closing, due, post, published } from "./follow-ups-act.ts";
import { add } from "./follow-ups-add.ts";

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
      args: {
        all: {
          type: "boolean",
          description: "Done and dropped ones too",
          default: false,
        },
        for: {
          type: "string",
          description:
            "Only those for agent, me, project:<name> or person:<name>",
        },
        project,
        json,
      },
      run: ({ args }) =>
        inProject(args.project, (store, place) => {
          const shown = store
            .followUps(place.root)
            .filter(
              f =>
                (args.all || f.status === "due" || f.status === "waiting") &&
                (args.for === undefined || f.for === args.for),
            );
          if (args.json) write(JSON.stringify(shown, undefined, 2));
          else for (const line of formatFollowUps(shown, args.all)) write(line);
        }),
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
