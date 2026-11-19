/**
 * @file The handover note a delegated worker's fresh session gets (the
 *   `sessions.freshOver` rule, specs/scheduler/fresh-sessions.md): its earlier
 *   tasks in this run and their reports, built by code with no model turn,
 *   newest first, within a cap.
 */

import type { Activation } from "./handle.ts";
import type { NodeResult } from "./types.ts";

/** One task a node was delegated earlier in this run, and how it reported. */
export type EarlierTask = { task: string; status: string; summary: string };

/** The note's cap in characters, as a sent-back input's (`MAX_INPUT`). */
export const HANDOVER_MAX = 8192;
/** A summary's cap, so one long report cannot crowd out the newest task. */
const SUMMARY_MAX = 2000;
/** A task with no description is named by its brief's first code points. */
const LABEL_MAX = 80;

const HEADING = "## Your earlier tasks in this run";
const LEAD_IN =
  "These tasks were done in an earlier session of yours that is not continued. Their work is in this checkout: read again what you need. Newest first:";

/** `text` cut to `max` code points, with a mark when cut. */
const clip = (text: string, max: number): string => {
  const points = Array.from(text);
  return points.length > max ? `${points.slice(0, max).join("")}…` : text;
};

const textOf = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** A delegated activation's task and the report it ended with. */
export const earlierTask = (
  activation: Activation,
  result: NodeResult,
): EarlierTask => {
  const brief = activation.brief?.text.replaceAll(/\s+/gu, " ").trim() ?? "";
  const status = textOf(result.output["status"]);
  return {
    task: clip(activation.description ?? brief, LABEL_MAX),
    status: status === "" ? (result.ok ? "pass" : "fail") : status,
    summary: textOf(result.output["summary"]),
  };
};

const entryOf = ({ task, status, summary }: EarlierTask): string =>
  [`### ${task} (${status})`, clip(summary, SUMMARY_MAX)]
    .filter(p => p !== "")
    .join("\n\n");

const compose = (entries: readonly string[], omitted: number): string =>
  [
    HEADING,
    LEAD_IN,
    ...entries,
    omitted === 0
      ? ""
      : `${String(omitted)} older task${omitted === 1 ? " is" : "s are"} left out to keep this note short.`,
  ]
    .filter(part => part !== "")
    .join("\n\n");

/**
 * The note for `tasks` (oldest first), newest first: older entries that do not
 * fit in `HANDOVER_MAX` are left out and counted. Undefined with no tasks.
 */
export const handoverNote = (
  tasks: readonly EarlierTask[],
): string | undefined => {
  if (tasks.length === 0) return undefined;
  const entries = tasks.toReversed().map(t => entryOf(t));
  for (let kept = entries.length; kept > 0; kept -= 1) {
    const note = compose(entries.slice(0, kept), entries.length - kept);
    if (note.length <= HANDOVER_MAX) return note;
  }
  return compose([], entries.length);
};
