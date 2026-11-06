/**
 * @file `ork feedback`'s helpers (specs/feedback.md): finding an item by a
 *   prefix of its fingerprint, the lines `list` and `show` print, and the
 *   writes a person makes: `restore` an item, `note` a run or node.
 */

import {
  type EventStore,
  type FeedbackItem,
  type FeedbackRecord,
  type FeedbackSeverity,
  findRun,
  type Noted,
  recordNote,
} from "@krapht/ork-core";

import { style } from "../output.ts";
import { ago } from "./format.ts";

export type FoundItem =
  | { ok: true; item: FeedbackItem }
  | { ok: false; error: string };

/** The item whose fingerprint starts with `prefix`, dismissed ones included. */
export const findFeedbackItem = (
  store: EventStore,
  prefix: string,
): FoundItem => {
  const found = store.findFeedback(prefix);
  const [item, other] = found;
  if (item === undefined) {
    return {
      ok: false,
      error: `No feedback item ${prefix}; see ork feedback list.`,
    };
  }
  if (other !== undefined) {
    return {
      ok: false,
      error: [
        `${prefix} matches ${String(found.length)} items:`,
        ...found.map(i => `  ${i.id}  ${i.title}`),
      ].join("\n"),
    };
  }
  return { ok: true, item };
};

const SEVERITY_STYLE: Record<FeedbackSeverity, "dim" | "yellow" | "red"> = {
  low: "dim",
  medium: "yellow",
  high: "red",
};

const about = (item: FeedbackItem): string => `${item.target}/${item.kind}`;

/** One line per item, most recently seen first. */
export const formatFeedbackItems = (
  items: readonly FeedbackItem[],
  now: number = Date.now(),
): string[] => {
  if (items.length === 0) return ["No feedback yet."];
  const width = Math.max(...items.map(i => about(i).length));
  return items.map(item => {
    const status =
      item.status === "new" ? "" : ` ${style("dim", `[${item.status}]`)}`;
    const times = `${String(item.count)}×`.padStart(4);
    return `${style("dim", item.id)} ${times} ${style(SEVERITY_STYLE[item.severity], about(item).padEnd(width))}  ${item.title}${status} ${style("dim", `· ${ago(item.lastSeen, now)}`)}`;
  });
};

const plural = (n: number, word: string): string =>
  `${String(n)} ${word}${n === 1 ? "" : "s"}`;

/** An item and each of its records. */
export const formatFeedbackItem = (
  item: FeedbackItem,
  records: readonly FeedbackRecord[],
  now: number = Date.now(),
): string[] => {
  const lines = [
    style("bold", item.title),
    style(
      "dim",
      `${item.id} · ${item.status} · ${about(item)} · ${item.severity} · from ${item.sources.join(", ")}`,
    ),
    `Seen ${plural(item.count, "time")} in ${plural(item.runs.length, "run")}, first ${ago(item.firstSeen, now)}, last ${ago(item.lastSeen, now)}.`,
  ];
  if (item.workflows.length > 0) {
    lines.push(`Workflows: ${item.workflows.join(", ")}`);
  }
  if (item.models.length > 0) lines.push(`Models: ${item.models.join(", ")}`);
  if (item.merged.length > 0) {
    lines.push(
      `Merged into it: ${item.merged.map(id => id.slice(0, 12)).join(", ")} (ork feedback split ${item.id.slice(0, 12)} takes them apart)`,
    );
  }
  for (const record of records) {
    const { feedback } = record;
    const where = record.node === undefined ? "" : ` · ${record.node}`;
    lines.push(
      "",
      style(
        "dim",
        `${ago(record.at, now)} · run ${record.runId}${where} · ${feedback.source}`,
      ),
    );
    if (feedback.title !== item.title) lines.push(`  ${feedback.title}`);
    if (feedback.body !== "") lines.push(`  ${feedback.body}`);
    if (feedback.evidence.length > 0) {
      lines.push(style("dim", `  evidence: ${feedback.evidence.join(", ")}`));
    }
  }
  return lines;
};

export type NoteArgs = {
  run: string;
  node?: string | undefined;
  text: string;
  kind?: string | undefined;
  severity?: string | undefined;
  rating?: string | undefined;
};

/**
 * `ork feedback note`: records a person's note on a run, or one of its nodes,
 * as that run's feedback; returns the item it joins, or why it could not.
 */
export const noteRun = (
  store: EventStore,
  cwd: string,
  args: NoteArgs,
): Noted => {
  const found = findRun(store, args.run, cwd);
  if (!found.ok) return found;
  return recordNote(store, found.run, args, "--");
};
