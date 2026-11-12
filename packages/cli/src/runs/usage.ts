/**
 * @file How usage reads on the terminal (`ork usage`, specs/usage.md), and the
 *   times its `--since`, `--until` and `ork prune --older-than` take.
 */

import type {
  LimitsReport,
  UsageDimension,
  UsageGroup,
  UsageReport,
} from "@krapht/ork-core";

import { costOf, shortCount, style } from "../output.ts";
import { CHIP_LABELS, chip } from "../term/chips.ts";
import { type Term, termOf } from "../term/mode.ts";
import { header, table } from "../term/table.ts";
import { cost } from "./format.ts";

const UNITS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

/** `30d`, `12w`, `24h` before `now`, as an ISO time; `null` when it is not one. */
export const agoTime = (text: string, now: number): string | null => {
  const match = /^(\d+)([hdw])$/u.exec(text);
  if (match === null) return null;
  const [, amount = "0", unit = "d"] = match;
  if (Number(amount) === 0) return null;
  const date = new Date(now - Number(amount) * (UNITS[unit] ?? 0));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** A `YYYY-MM-DD` day's start in the machine's time zone, `after` days on. */
const dayTime = (text: string, after: number): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (match === null) return null;
  const [, year = "", month = "", day = ""] = match;
  const start = new Date(Number(year), Number(month) - 1, Number(day));
  // `2026-13-45` would roll over to a real day.
  if (start.getMonth() !== Number(month) - 1) return null;
  if (start.getDate() !== Number(day)) return null;
  start.setDate(start.getDate() + after);
  return start.toISOString();
};

/** The start of the day `days` whole days ago, counting today as one. */
const wholeDays = (days: number, now: number): string => {
  const today = new Date(now);
  return new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - (days - 1),
  ).toISOString();
};

/**
 * `--since`: an age or the day it starts from. Days and weeks are whole days,
 * today among them, as the Usage panel counts them; hours are exact.
 */
export const sinceTime = (text: string, now: number): string | null => {
  const ago = agoTime(text, now);
  if (ago === null) return dayTime(text, 0);
  if (text.endsWith("h")) return ago;
  const amount = Number(text.slice(0, -1));
  return wholeDays(text.endsWith("w") ? amount * 7 : amount, now);
};

/** `--until`: the last day it includes. */
export const untilTime = (text: string): string | null => dayTime(text, 1);

/** `950`, `12.3k`, `4.5M`. */
export const tokens = shortCount;

const percent = (share: number): string =>
  `${String(Math.round(share * 100))}%`;

const counted = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

const TITLES: Record<UsageDimension, string> = {
  day: "By day",
  week: "By week",
  month: "By month",
  workflow: "By workflow",
  node: "Costliest nodes",
  model: "By model",
  driver: "By driver",
  project: "By project",
};

/** Seconds of CPU, `12.3 s`; empty with none. */
const cpuText = (ms: number): string =>
  ms === 0 ? "" : `${(ms / 1000).toFixed(1)} s`;

/** `cpu`: a column for the CPU Ork's tool commands used. */
const usageTable = (
  term: Term,
  groups: readonly UsageGroup[],
  cpu = false,
): string[] =>
  table(
    term,
    [
      { flex: true },
      { align: "right" },
      { align: "right" },
      {},
      {},
      ...(cpu ? [{ align: "right" as const }] : []),
    ],
    [
      [
        header(""),
        header("COST"),
        header("SESSIONS"),
        header("TOKENS"),
        header("CACHE"),
        ...(cpu ? [header("TOOL CPU")] : []),
      ],
      ...groups.map(group => [
        { text: group.key },
        { text: cost(group.costUsd) },
        { text: String(group.sessions) },
        {
          text: `${tokens(group.inputTokens + group.cacheReadTokens + group.cacheWriteTokens)} prompt / ${tokens(group.outputTokens)} out`,
        },
        { text: percent(group.cacheHitRate) },
        ...(cpu ? [{ text: cpuText(group.cpuMs) }] : []),
      ]),
    ],
    "  ",
  );

/** What `ork usage` prints without `--by`. */
const OVERVIEW: readonly UsageDimension[] = [
  "day",
  "workflow",
  "model",
  "node",
];
/** How many rows the overview shows of each; `--by` shows them all. */
const OVERVIEW_ROWS = 10;

const shortTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

/** A warning line: a `WARN` chip when rich, else the line in yellow. */
const warned = (term: Term, text: string): string =>
  term.rich
    ? `  ${chip(term, CHIP_LABELS.warn, "warn")} ${text}`
    : style("yellow", `  ${text}`);

/**
 * `$0.0000 of $0.0100`: both sides of a dollar cap with the same digits, four
 * when either is under a dollar, else cents (`usd` alone gives `$0.00 of
 * $0.0100`).
 */
const capAmounts = (spent: number, cap: number): string => {
  const places = cap < 1 || (spent > 0 && spent < 1) ? 4 : 2;
  return `$${spent.toFixed(places)} of $${cap.toFixed(places)}`;
};

/** The limits across runs, above a report; nothing with none set. */
export const formatLimits = (
  { problems, caps, tokenCaps = [], plan }: LimitsReport,
  term: Term = termOf(process.stdout),
): string[] => {
  if (
    problems.length === 0 &&
    caps.length === 0 &&
    tokenCaps.length === 0 &&
    plan.length === 0
  ) {
    return [];
  }
  return [
    style("bold", "Limits"),
    ...problems.map(problem => warned(term, problem)),
    ...caps.map(cap => {
      const whose = cap.project === undefined ? "all projects" : "this project";
      const line = `  ${whose}, this ${cap.window}: ${capAmounts(cap.spentUsd, cap.capUsd)}, resets ${shortTime(cap.resetsAt)}`;
      return cap.leftUsd <= 0 ? warned(term, line.trimStart()) : line;
    }),
    ...tokenCaps.map(cap => {
      const whose = cap.project === undefined ? "all projects" : "this project";
      const line = `  ${whose}, this ${cap.window}: ${tokens(cap.spentTokens)} of ${tokens(cap.capTokens)} tokens, resets ${shortTime(cap.resetsAt)}`;
      return cap.leftTokens <= 0 ? warned(term, line.trimStart()) : line;
    }),
    ...plan.map(limit =>
      warned(
        term,
        `Claude plan's ${limit.window.replaceAll("_", " ")} limit ${limit.status === "rejected" ? "was reached" : "is close"}${limit.resetsAt === undefined ? "" : `, resets ${shortTime(limit.resetsAt)}`}`,
      ),
    ),
    "",
  ];
};

/** The report, as the terminal shows it. */
export const formatUsage = (
  report: UsageReport,
  scope: string,
  by?: UsageDimension,
  term: Term = termOf(process.stdout),
): string[] => {
  const { totals } = report;
  if (totals.sessions === 0) return [`No Claude sessions in ${scope}.`];
  const head = [
    `${style("bold", costOf(totals.costUsd, totals.partial, totals.tokens))} in ${scope}`,
    `${counted(totals.runs, "run")} · ${counted(totals.sessions, "session")} · ${counted(totals.turns, "turn")} · ${tokens(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens)} prompt / ${tokens(totals.outputTokens)} out${totals.tokens === undefined ? "" : ` (${tokens(totals.tokens)} counted)`} · ${percent(totals.cacheHitRate)} from cache`,
  ];
  const lines = head;
  for (const dimension of by === undefined ? OVERVIEW : [by]) {
    const groups = report.groups[dimension];
    // Times are oldest first, the rest costliest first: each keeps what matters.
    const shown =
      by === undefined
        ? dimension === "day"
          ? groups.slice(-OVERVIEW_ROWS)
          : groups.slice(0, OVERVIEW_ROWS)
        : groups;
    lines.push(
      "",
      style("bold", TITLES[dimension]),
      ...usageTable(term, shown, dimension === "node"),
    );
    if (shown.length < groups.length) {
      lines.push(
        style(
          "dim",
          `  and ${String(groups.length - shown.length)} more (--by ${dimension})`,
        ),
      );
    }
  }
  const hints =
    report.hints.length === 0
      ? []
      : [
          "",
          style("bold", "Worth a look"),
          ...report.hints.map(h => `  ${h.message}`),
        ];
  return [
    ...lines,
    ...hints,
    "",
    style(
      "dim",
      "Costs are Claude Code's own estimates. On a subscription they are not what you are billed.",
    ),
  ];
};
