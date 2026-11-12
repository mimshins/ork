/**
 * @file The times every list's `--since` and `--until` take (specs/usage.md,
 *   RFC-017), and `ork prune --older-than`'s age: an age (`24h`, `30d`, `12w`)
 *   or a day (`2026-11-01`, in the machine's time zone).
 */

export const UNITS: Record<string, number> = {
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
export const dayTime = (text: string, after: number): string | null => {
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
export const wholeDays = (days: number, now: number): string => {
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
