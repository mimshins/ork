/**
 * @file The generated parts of `benchmarks/`: `results.json`, one entry per
 *   published benchmark with its comparison against a manual session, and the
 *   results table in `benchmarks/README.md`, between its two markers. The
 *   manual rate is published only as aggregates: counts and quartiles, never a
 *   session, a window or a date.
 */

import { type Json, rec, records, text } from "./json.ts";

export const TABLE_START = "<!-- results:start -->";
export const TABLE_END = "<!-- results:end -->";

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const trio = (v: unknown): [number, number, number] => {
  const [a, b, c] = Array.isArray(v) ? v.map(x => num(x)) : [];
  return [a ?? 0, b ?? 0, c ?? 0];
};

/** One benchmark's line in `results.json`. */
const entryOf = (summary: Json, estimates: readonly Json[]) => {
  const name = text(summary["benchmark"]) ?? "";
  const estimate = estimates.find(e => text(e["name"]) === name);
  const minutes = rec(summary["minutes"]);
  return {
    benchmark: name,
    run: text(summary["run"]) ?? "",
    ork: rec(summary["ork"])["versions"] ?? [],
    status: text(summary["status"]) ?? "",
    started: text(summary["started"]) ?? "",
    cost_usd: num(summary["cost_usd"]),
    working_min: num(minutes["working"]),
    waiting_min: num(minutes["waiting_on_maintainer"]),
    wall_min: num(minutes["wall"]),
    sessions: num(summary["sessions"]),
    failed_sessions: num(summary["failed_sessions"]),
    permission_requests: num(summary["permission_requests"]),
    result_commits: summary["result_commits"] ?? [],
    changed_lines: estimate === undefined ? null : num(estimate["lines"]),
    manual_usd: estimate === undefined ? null : trio(estimate["manual_usd"]),
    manual_working_min:
      estimate === undefined ? null : trio(estimate["manual_working_min"]),
  };
};

/** `results.json`: the manual rate's aggregates and every benchmark's line. */
export const resultsOf = (summaries: readonly Json[], control: Json) => {
  const rate = rec(control["rate"]);
  return {
    manual_rate: {
      sessions: num(rate["sessions"]),
      windows: num(rate["windows"]),
      commits: num(rate["commits"]),
      changed_lines: num(rate["lines"]),
      usd_per_1000_lines: trio(rate["usd_per_kline"]),
      working_min_per_1000_lines: trio(rate["min_per_kline"]),
    },
    benchmarks: summaries
      .map(s => entryOf(s, records(control["estimates"])))
      .toSorted((a, b) => a.started.localeCompare(b.started)),
  };
};

type Results = ReturnType<typeof resultsOf>;

const usd = (v: number) => `$${v.toFixed(2)}`;
const range = (
  [low, mid, high]: [number, number, number],
  show: (v: number) => string,
) => `${show(mid)} (${show(low)}–${show(high)})`;
const min = (v: number) => v.toFixed(0);

/** The results table that goes between the README's markers. */
export const resultsTable = (results: Results): string => {
  const head = [
    "| Benchmark | Ork | Status | Changed lines | Ork cost | Manual cost: median (p25–p75) | Ork working min | Manual min: median (p25–p75) |",
    "| --- | --- | --- | --: | --: | --: | --: | --: |",
  ];
  const rows = results.benchmarks.map(b => {
    const manual = [
      b.changed_lines?.toLocaleString("en-US") ?? "—",
      usd(b.cost_usd),
      b.manual_usd === null ? "—" : range(b.manual_usd, usd),
      min(b.working_min),
      b.manual_working_min === null ? "—" : range(b.manual_working_min, min),
    ];
    const versions = Array.isArray(b.ork) ? b.ork.join(", ") : "";
    return `| [${b.benchmark}](./${b.benchmark}/README.md) | ${versions} | ${b.status} | ${manual.join(" | ")} |`;
  });
  const rate = results.manual_rate;
  const basis = [
    `The manual columns apply a rate measured over ${String(rate.windows)} pushes`,
    `in ${String(rate.sessions)} plain Claude Code sessions on this repository`,
    `(${String(rate.commits)} commits, ${rate.changed_lines.toLocaleString("en-US")} changed lines):`,
    `${range(rate.usd_per_1000_lines, usd)} and ${range(rate.working_min_per_1000_lines, min)}`,
    "working minutes per 1,000 changed lines. [How](./method.md#the-manual-baseline).",
  ].join(" ");
  return [...head, ...rows, "", basis].join("\n");
};

/** `readme` with the table between its markers replaced. */
export const withTable = (readme: string, table: string): string => {
  const start = readme.indexOf(TABLE_START);
  const end = readme.indexOf(TABLE_END);
  if (start === -1 || end < start) return readme;
  return `${readme.slice(0, start + TABLE_START.length)}\n\n${table}\n\n${readme.slice(end)}`;
};
