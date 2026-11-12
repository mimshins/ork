/**
 * @file `ork follow-ups add`: a follow-up the maintainer adds by hand, with its
 *   `for`, `kind` and `due`, a message's draft or a task's steps. It is kept
 *   where the project's rule says, and one for another project goes into that
 *   project's list and, when a run is live there, to its session.
 */

import {
  deliverFollowUp,
  followUpProblem,
  type FollowUpStep,
  type NewFollowUp,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { fail, inProject, json, project } from "../follow-ups/command.ts";
import { followUpsRule } from "../follow-ups/context.ts";
import { plain, style, write, writeErr } from "../output.ts";
import { flagValues } from "./run.ts";

/** `text :: command` as a step; the command is optional. */
const stepOf = (raw: string): FollowUpStep => {
  const [text = "", command] = raw.split(" :: ", 2);
  return command === undefined
    ? { text: text.trim() }
    : { text: text.trim(), command: command.trim() };
};

const defaultKind = (value: string): NewFollowUp["kind"] => {
  if (value.startsWith("person:")) return "message";
  return value === "agent" || value.startsWith("project:") ? "change" : "task";
};

const isKind = (value: string): value is NewFollowUp["kind"] =>
  ["change", "message", "task", "check"].includes(value);

// followUpProblem says what is wrong with a value that is not one of these.
const isFor = (value: string): value is NewFollowUp["for"] =>
  /^(?:agent|me|project:.+|person:.+)$/u.test(value);

const isDue = (value: string): value is NewFollowUp["due"] =>
  /^(?:now|after-merge|after-deploy|\d+-\d+-\d+)$/u.test(value);

export const add = defineCommand({
  meta: {
    name: "add",
    description:
      "Add a follow-up: --for agent|me|project:<name>|person:<name>, --kind, --due",
  },
  args: {
    title: { type: "positional", description: "What it is", required: true },
    for: {
      type: "string",
      description: "agent, me, project:<name> or person:<name> (default: me)",
    },
    kind: {
      type: "string",
      description: "change, message, task or check (default: by --for)",
    },
    due: {
      type: "string",
      description:
        "now, after-merge, after-deploy or a YYYY-MM-DD date (default: now)",
    },
    body: { type: "string", description: "What and why" },
    where: { type: "string", description: "A file it is about (repeatable)" },
    ref: { type: "string", description: "The PR or branch it waits on" },
    to: { type: "string", description: "A message: who it is to" },
    channel: {
      type: "string",
      description: "A message: slack, email, github…",
    },
    text: { type: "string", description: "A message: its text, to send" },
    step: {
      type: "string",
      description:
        "A task's step, `text` or `text :: command` (repeatable); Ork never runs it",
    },
    project,
    json,
  },
  run: ({ args, rawArgs }) =>
    inProject(args.project, async (store, place) => {
      const recipient = args.for ?? "me";
      const kind = args.kind ?? defaultKind(recipient);
      if (!isKind(kind)) {
        fail("--kind is change, message, task or check.");
        return;
      }
      const due = args.due ?? "now";
      if (!isFor(recipient) || !isDue(due)) {
        fail(
          isFor(recipient)
            ? "--due is now, after-merge, after-deploy or a YYYY-MM-DD date."
            : "--for is agent, me, project:<name> or person:<name>.",
        );
        return;
      }
      const steps = flagValues(rawArgs, "--step").map(raw => stepOf(raw));
      const input: NewFollowUp = {
        title: args.title,
        for: recipient,
        kind,
        due,
        where: flagValues(rawArgs, "--where"),
        ...(args.body === undefined ? {} : { body: args.body }),
        ...(args.ref === undefined ? {} : { ref: args.ref }),
        ...(args.text === undefined
          ? {}
          : {
              draft: {
                to: args.to ?? recipient.replace(/^person:/u, ""),
                ...(args.channel === undefined
                  ? {}
                  : { channel: args.channel }),
                text: args.text,
              },
            }),
        ...(steps.length === 0 ? {} : { steps }),
      };
      const problem = followUpProblem(input);
      if (problem !== null) {
        fail(`${problem}.`);
        return;
      }
      const rule = followUpsRule(place);
      const delivered = await deliverFollowUp(input, {
        store,
        project: place.root,
        ...(rule === undefined ? {} : { rule }),
      });
      if (!delivered.ok) {
        fail(delivered.error);
        return;
      }
      if (args.json) {
        write(JSON.stringify(delivered, undefined, 2));
        return;
      }
      const { added, relayed } = delivered;
      const { followUp } = added;
      write(
        `${style("green", "✓")} ${added.merged ? "merged into" : "added"} ${followUp.id}: ${plain(followUp.title)}`,
      );
      if (added.note !== undefined) writeErr(style("dim", added.note));
      if (relayed !== undefined) {
        write(
          style(
            "dim",
            `  sent to ${relayed.node} of run ${relayed.run}, which is live in that project`,
          ),
        );
      }
    }),
});
