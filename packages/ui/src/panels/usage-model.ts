/**
 * @file What the Usage panel draws, from the server's report: the periods it
 *   offers, a continuous series of bars with the empty days filled in, and how
 *   its numbers read.
 */

import type { UsageReport } from "@krapht/ork-server/client";

import type { Option } from "../components/select.tsx";

const ALL_TIME = "all";

export const PERIODS: readonly Option[] = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: ALL_TIME, label: "All time" },
];

export const DEFAULT_PERIOD = "30";

const DAY_MS = 86_400_000;

/** When a period starts, as an ISO time; `undefined` for all time. */
export const sinceOf = (period: string, now: number): string | undefined =>
  period === ALL_TIME
    ? undefined
    : new Date(now - Number(period) * DAY_MS).toISOString();

export type Bar = { key: string; costUsd: number; sessions: number };

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

/** `$0.0312` for small sums, `$12.34` once cents are enough. */
export const money = (usd: number): string =>
  `$${usd.toFixed(usd !== 0 && usd < 10 ? 4 : 2)}`;

/** `950`, `12.3k`, `4.5M`. */
export const tokens = (count: number): string => {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
};

export const percent = (share: number): string =>
  `${String(Math.round(share * 100))}%`;
