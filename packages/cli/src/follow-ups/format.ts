/**
 * @file How `ork follow-ups` prints: the list grouped by status (due first),
 *   then by who it is for, and one follow-up whole, with its draft and its
 *   steps laid out to copy. Ork never runs a step's command; it only shows it.
 *   Their text comes from sessions, so escape sequences are stripped first.
 */

import type { FollowUp, FollowUpStatus } from "@krapht/ork-core";

import { plain, style } from "../output.ts";

/** The groups of the list, in the order they are shown. */
const GROUPS: readonly { status: FollowUpStatus; title: string }[] = [
  { status: "due", title: "Due" },
  { status: "waiting", title: "Waiting" },
  { status: "done", title: "Done" },
  { status: "dropped", title: "Dropped" },
];

/** `agent` first, then the maintainer, other projects, then people. */
const FOR_ORDER = ["agent", "me", "project:", "person:"] as const;

const forOrder = (value: string): number =>
  FOR_ORDER.findIndex(prefix => value.startsWith(prefix));

/** The list's order within a status: by who it is for. */
export const byFor = (a: FollowUp, b: FollowUp): number =>
  forOrder(a.for) - forOrder(b.for) || a.for.localeCompare(b.for);

/** A multi-line text, each line safe to print. */
const linesOf = (text: string): string[] =>
  text.split("\n").map(line => plain(line));

const when = (f: FollowUp): string =>
  f.ref === undefined ? f.due : `${f.due} ${f.ref}`;

/** One follow-up on one line. */
export const followUpLine = (f: FollowUp): string =>
  `${style("dim", f.id)}  ${f.kind.padEnd(7)} ${plain(f.title)} ${style("dim", `(${plain(when(f))})`)}`;

/**
 * The follow-ups grouped by status, then by `for`; the closed ones only with
 * `all`. A line each, under a heading each.
 */
export const formatFollowUps = (
  followUps: readonly FollowUp[],
  all: boolean,
): string[] => {
  const lines: string[] = [];
  for (const group of GROUPS) {
    if (!all && group.status !== "due" && group.status !== "waiting") continue;
    const inGroup = followUps
      .filter(f => f.status === group.status)
      .toSorted(byFor);
    if (inGroup.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(style("bold", `${group.title} (${String(inGroup.length)})`));
    for (const kind of new Set(inGroup.map(f => f.for))) {
      lines.push(`  ${style("cyan", `for ${plain(kind)}`)}`);
      for (const f of inGroup.filter(one => one.for === kind)) {
        lines.push(`    ${followUpLine(f)}`);
      }
    }
  }
  return lines.length === 0 ? [style("dim", "No follow-ups.")] : lines;
};

const fromLine = (f: FollowUp): string[] =>
  f.from.run === undefined
    ? []
    : [
        `from run ${plain(f.from.run)}${f.from.node === undefined ? "" : `, node ${plain(f.from.node)}`}`,
      ];

/** One follow-up whole: its record, its draft and its steps, ready to copy. */
export const formatFollowUp = (f: FollowUp): string[] => [
  `${style("bold", plain(f.title))}  ${style("dim", f.id)}`,
  `status ${f.status}${f.note === undefined ? "" : ` (${plain(f.note)})`}, for ${plain(f.for)}, ${f.kind}, due ${plain(f.due)}`,
  ...(f.ref === undefined ? [] : [`waits on ${plain(f.ref)}`]),
  ...fromLine(f),
  ...(f.where.length === 0
    ? []
    : [`files ${f.where.map(file => plain(file)).join(", ")}`]),
  ...(f.url === undefined ? [] : [`kept at ${plain(f.url)}`]),
  ...(f.body === "" ? [] : ["", ...linesOf(f.body)]),
  ...(f.draft === undefined
    ? []
    : [
        "",
        style(
          "bold",
          `Draft to ${plain(f.draft.to)}${f.draft.channel === undefined ? "" : ` (${plain(f.draft.channel)})`}: copy it, send it, then \`ork follow-ups done ${f.id}\``,
        ),
        ...linesOf(f.draft.text).map(line => `  ${line}`),
      ]),
  ...(f.steps === undefined
    ? []
    : [
        "",
        style("bold", "Steps (Ork never runs them):"),
        ...f.steps.flatMap((step, index) => [
          `  ${String(index + 1)}. ${plain(step.text)}`,
          ...(step.command === undefined
            ? []
            : [`     ${plain(step.command)}`]),
        ]),
      ]),
];
