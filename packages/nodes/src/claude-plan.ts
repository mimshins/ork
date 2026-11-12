/**
 * @file What a Claude node's session is planned with, read from the node's
 *   context, and what it is told beyond its plan: the note of a sent-back input
 *   on re-entry, a resumed leader's message, and the turn for messages that
 *   came in as it finished.
 */

import path from "node:path";

import type { ExecuteContext, PlanOptions } from "@krapht/ork-core";

/** The plan options every session of a node starts from. */
export const planOptionsOf = (
  context: ExecuteContext,
  inPlace: boolean,
): PlanOptions => {
  const planOptions: PlanOptions = {
    cwd: context.cwd,
    inputs: context.inputs,
    outputs: context.outputs,
    inPlace,
    workflowDir: context.workflowDir,
    projectRoot: context.projectRoot,
    ...(context.orkDir === undefined ? {} : { orkDir: context.orkDir }),
    pluginDir: path.join(context.runDir, "plugins", context.id),
  };
  if (context.checkout !== undefined) planOptions.checkout = context.checkout;
  if (context.brief !== undefined) planOptions.brief = context.brief;
  if (context.template !== undefined) planOptions.template = context.template;
  if (context.item !== undefined) planOptions.item = context.item;
  if (context.ownership !== undefined) {
    planOptions.ownership = context.ownership;
  }
  if (context.mailbox !== undefined) planOptions.mailbox = context.mailbox;
  if (context.claims !== undefined) planOptions.claims = context.claims;
  return planOptions;
};

const MAX_INPUT = 8192;

const inputJson = (input: unknown): string =>
  JSON.stringify(input ?? {}, undefined, 2);

/** What a sent-back input is whole, for `read_input`, when its note cuts it. */
export const wholeInput = (input: unknown): string | undefined => {
  const json = inputJson(input);
  return json.length > MAX_INPUT ? json : undefined;
};

/** A re-entry's note of what was sent back; `read_input` has a cut rest. */
export const reentryNote = (round: number, input: unknown): string => {
  const json = inputJson(input);
  const cut = json.length > MAX_INPUT;
  const body = cut ? `${json.slice(0, MAX_INPUT)}\n…` : json;
  const rest = cut
    ? `\n\nThat is the first ${String(MAX_INPUT)} of its ${String(json.length)} characters. Call read_input for all of it before you act on it.`
    : "";
  return `\n\n## Round ${String(round)}\n\nThe workflow sent this task back to you with:\n\n\`\`\`json\n${body}\n\`\`\`${rest}`;
};

/**
 * What a resumed leader is told: it already has its brief and its earlier work,
 * so only the new round, and the new task when its owner sent one.
 */
export const resumeMessage = (
  round: number,
  input: unknown,
  brief?: { from: string; text: string },
): string =>
  [
    brief === undefined
      ? sentBack(round, input)
      : `## New task from \`${brief.from}\`\n\n${brief.text}`,
    "End with a new structured report.",
  ].join("\n\n");

/** A first-round resume is a session the run was cut off in (`ork resume`). */
const sentBack = (round: number, input: unknown): string =>
  round === 1
    ? "Ork was stopped while you worked on this task, and the run is resumed. Your earlier turns are above: check what you finished, and carry on from there."
    : `The workflow sent your task back to you.${reentryNote(round, input)}`;

/** What a session is told when messages came in as it finished. */
export const lateMessage = (count: number): string =>
  `[ork] ${String(count)} message${count === 1 ? "" : "s"} came in while you finished. Call read_inbox, act on ${count === 1 ? "it" : "them"} if needed, and end with a new structured report.`;
