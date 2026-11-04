/**
 * @file How usage reads on the terminal (`ork usage`, specs/usage.md), and the
 *   times its `--since`, `--until` and `ork prune --older-than` take.
 */

import {
  type LimitsReport,
  type UsageDimension,
  type UsageGroup,
  type UsageReport,
  usd,
} from "@krapht/ork-core";

import { style } from "../output.ts";
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
export const tokens = (count: number): string => {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
};

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

const table = (groups: readonly UsageGroup[]): string[] => {
  const rows = groups.map(group => ({
    key: group.key,
    cost: cost(group.costUsd),
    sessions: String(group.sessions),
    tokens: `${tokens(group.inputTokens + group.cacheReadTokens + group.cacheWriteTokens)} in / ${tokens(group.outputTokens)} out`,
    cache: percent(group.cacheHitRate),
  }));
  const width = (pick: (row: (typeof rows)[number]) => string, title: string) =>
    Math.max(title.length, ...rows.map(row => pick(row).length));
  const w = {
    key: width(r => r.key, ""),
    cost: width(r => r.cost, "COST"),
    sessions: width(r => r.sessions, "SESSIONS"),
    tokens: width(r => r.tokens, "TOKENS"),
  };
  const line = (key: string, c: string, s: string, t: string, h: string) =>
    `  ${key.padEnd(w.key)}  ${c.padStart(w.cost)}  ${s.padStart(w.sessions)}  ${t.padEnd(w.tokens)}  ${h}`;
  return [
    style("dim", line("", "COST", "SESSIONS", "TOKENS", "CACHE")),
    ...rows.map(r => line(r.key, r.cost, r.sessions, r.tokens, r.cache)),
  ];
};

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

/** The limits across runs, above a report; nothing with none set. */
export const formatLimits = ({
  problems,
  caps,
  plan,
}: LimitsReport): string[] => {
  if (problems.length === 0 && caps.length === 0 && plan.length === 0) {
    return [];
  }
  return [
    style("bold", "Limits"),
    ...problems.map(problem => style("yellow", `  ${problem}`)),
    ...caps.map(cap => {
      const whose = cap.project === undefined ? "all projects" : "this project";
      const line = `  ${whose}, this ${cap.window}: ${usd(cap.spentUsd)} of ${usd(cap.capUsd)}, resets ${shortTime(cap.resetsAt)}`;
      return cap.leftUsd <= 0 ? style("yellow", line) : line;
    }),
    ...plan.map(limit =>
      style(
        "yellow",
        `  Claude plan's ${limit.window.replaceAll("_", " ")} limit ${limit.status === "rejected" ? "was reached" : "is close"}${limit.resetsAt === undefined ? "" : `, resets ${shortTime(limit.resetsAt)}`}`,
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
): string[] => {
  const { totals } = report;
  if (totals.sessions === 0) return [`No Claude sessions in ${scope}.`];
  const head = [
    `${style("bold", cost(totals.costUsd))} in ${scope}`,
    `${counted(totals.runs, "run")} · ${counted(totals.sessions, "session")} · ${counted(totals.turns, "turn")} · ${tokens(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens)} in / ${tokens(totals.outputTokens)} out · ${percent(totals.cacheHitRate)} from cache`,
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
    lines.push("", style("bold", TITLES[dimension]), ...table(shown));
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
