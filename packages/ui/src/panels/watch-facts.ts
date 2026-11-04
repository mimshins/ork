/**
 * @file What a node's `watch:` is waiting for, in words (RFC-011). The store
 *   records changes, not looks, so the count since the last change and the next
 *   look are worked out from `every`, and say "about".
 */

import type { TreeNode } from "@krapht/ork-server/client";

type Watching = NonNullable<TreeNode["watching"]>;

const UNITS: Readonly<Record<string, number>> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

const everyMs = (every: string): number => {
  const match = /^(\d+)([smh])$/u.exec(every);
  return Number(match?.[1] ?? 0) * (UNITS[match?.[2] ?? "s"] ?? 1000);
};

const inWords = (ms: number): string => {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60
    ? `${String(minutes)} min`
    : `${String(Math.ceil(minutes / 60))} h`;
};

/** A run that's over isn't waiting, whatever its last event said. */
export const stillGoing = (status: string): boolean =>
  status === "running" || status === "paused";

export type WatchFacts = {
  until: string;
  every: string;
  looks: string;
  next: string;
  said?: string | undefined;
};

export const watchFacts = (watching: Watching, now: number): WatchFacts => {
  const every = everyMs(watching.every);
  const since = Math.max(0, now - Date.parse(watching.at));
  const passed = every === 0 ? 0 : Math.floor(since / every);
  const looks = watching.looks + passed;
  return {
    until: watching.until,
    every: `every ${watching.every}`,
    looks: `${passed === 0 ? "" : "about "}${String(looks)}`,
    next: `in about ${inWords(every === 0 ? 0 : every - (since % every))}`,
    said: watching.said,
  };
};
