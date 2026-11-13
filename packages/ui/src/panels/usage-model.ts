/**
 * @file What the Usage panel draws, from the server's report: the periods it
 *   offers, a continuous series of bars with the empty days filled in, and how
 *   its numbers read.
 */

import type { UsageReport } from "@krapht/ork-server/client";

import { atLeast, formatCost, formatTokens } from "../graph/facts.ts";

const ALL_TIME = "all";

/** What the bar's `since` starts at, in the CLI's words. */
export const DEFAULT_SINCE = "30d";

/** Whether a period is everything there is. */
export const isAllTime = (period: string): boolean => period === ALL_TIME;

/**
 * When a period starts, as an ISO time; `undefined` for all time. It counts
 * whole days, today among them, so seven days draw seven bars.
 */
export const sinceOf = (period: string, now: number): string | undefined => {
  if (isAllTime(period)) return undefined;
  const today = new Date(now);
  return new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - (Number(period) - 1),
  ).toISOString();
};

/**
 * The `since` the bar holds as the query the chart can draw from: an age in
 * days or weeks or a day as a midnight, counting today (`sinceOf`), hours as a
 * time, `undefined` for all. Anything else goes as typed, for the server to
 * read or refuse.
 */
export const sinceQuery = (since: string, now: number): string | undefined => {
  const age = /^(\d+)([dwh])$/u.exec(since);
  const day = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(since);
  if (isAllTime(since)) return undefined;
  if (age !== null) {
    const count = Number(age[1]);
    if (count === 0) return since;
    return age[2] === "h"
      ? new Date(now - count * 3_600_000).toISOString()
      : sinceOf(String(age[2] === "w" ? count * 7 : count), now);
  }
  return day === null
    ? since
    : new Date(
        Number(day[1]),
        Number(day[2]) - 1,
        Number(day[3]),
      ).toISOString();
};

/** The same report on the terminal; a project is the one it is run from. */
export const usageCommand = (
  everyProject: boolean,
  since: string,
  by?: string,
): string =>
  [
    "ork usage",
    ...(everyProject ? ["--project", "all"] : []),
    `--since ${since}`,
    ...(by === undefined ? [] : [`--by ${by}`]),
  ].join(" ");

export type Bar = {
  key: string;
  costUsd: number;
  sessions: number;
  /** Counted tokens (RFC-015). */
  tokens?: number | undefined;
  /** Some sessions ran on a driver with no price: `costUsd` misses them. */
  partial?: boolean | undefined;
};

export type Series = {
  /** What one bar is. */
  unit: "day" | "week";
  bars: Bar[];
  maxUsd: number;
};

/** More days than this read better as weeks. */
const MOST_DAYS = 92;

const pad = (value: number): string => String(value).padStart(2, "0");

const dateKey = (date: Date): string =>
  `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const parseKey = (key: string): Date => {
  const [year = 0, month = 1, day = 1] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const mondayOf = (date: Date): Date =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - ((date.getDay() + 6) % 7),
  );

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Every bucket from `first` to `last`, the empty ones at zero. */
const filled = (
  groups: readonly Bar[],
  stepDays: number,
  first: Date,
  last: Date,
): Bar[] => {
  const byKey = new Map(groups.map(group => [group.key, group]));
  const bars: Bar[] = [];
  for (
    let date = first;
    date <= last;
    date = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + stepDays,
    )
  ) {
    const key = dateKey(date);
    bars.push(byKey.get(key) ?? { key, costUsd: 0, sessions: 0 });
  }
  return bars;
};

/**
 * The bars to draw, up to today so an idle stretch shows: from the period's
 * start, or the first spend when the period is all time. By week when there are
 * too many days.
 */
export const seriesOf = (
  report: UsageReport,
  since: string | undefined,
  now: number,
): Series => {
  const days = report.groups.day;
  const first = since === undefined ? days[0]?.key : undefined;
  if (since === undefined && first === undefined) {
    return { unit: "day", bars: [], maxUsd: 0 };
  }
  const start =
    since === undefined ? parseKey(first ?? "") : startOfDay(new Date(since));
  const today = startOfDay(new Date(now));
  const span = filled(days, 1, start, today);
  const unit = span.length > MOST_DAYS ? "week" : "day";
  const bars =
    unit === "day"
      ? span
      : filled(report.groups.week, 7, mondayOf(start), today);
  return {
    unit,
    bars,
    maxUsd: Math.max(0, ...bars.map(bar => bar.costUsd)),
  };
};

/** One sum on its own. */
export const money = (usd: number): string => formatCost(usd);

/** How a table's sums read, all to one precision. */
export const moneyOf = (sums: readonly number[]): ((usd: number) => string) => {
  const among = [...sums];
  return usd => formatCost(usd, among);
};

export const tokens = formatTokens;

/** One sum, a floor when some sessions' dollars are missing from it. */
export const partialMoney = (usd: number, partial: boolean): string =>
  atLeast(money(usd), partial);

export const percent = (share: number): string =>
  `${String(Math.round(share * 100))}%`;
