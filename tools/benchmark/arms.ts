/**
 * @file `pnpm benchmark:arms <folder> <name>…`: sets benchmarks of the same
 *   tasks side by side by arm, for an A/B benchmark such as RFC-025's reading
 *   rule. Each name is `<prefix>-<task>-<arm>-<n>`; its `summary.json` gives
 *   status, cost, working minutes and sessions, and the carried-weight report
 *   (carried.ts) gives the weight of reads, searches and diffs by role group,
 *   turns, and the calls of each kind with Ork's refusals, and the fresh starts
 *   the sessions rule made with the would-fires (sessions.ts). Prints a
 *   Markdown table of the runs and of each task and arm's medians; `--json`
 *   prints the rows instead. Like carried.ts, its output holds only names and
 *   numbers.
 */

import { readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

import { carriedReport } from "./carried.ts";
import { count, parse, r1, r2, rec, text } from "./json.ts";
import { copyStore, loadTree } from "./tree.ts";

/** The kinds that read: what RFC-023 and RFC-025 set out to cut. */
const READING = new Set([
  "reads through the shell",
  "searches",
  "git diff/show/log",
  "Read",
  "extract",
]);
/** Kinds that read around `extract`. */
const AROUND = new Set([
  "reads through the shell",
  "searches",
  "git diff/show/log",
]);

/** A role's group: review, implement (the nodes that write), or other. */
export const groupOf = (role: string): "review" | "implement" | "other" => {
  const node = role.slice(role.indexOf(".") + 1);
  if (node.includes("review")) return "review";
  if (["docs", "followups", "followup-pick", "declare"].includes(node)) {
    return "other";
  }
  return "implement";
};

/** One run's numbers. */
export type Row = {
  name: string;
  task: string;
  arm: string;
  run: string;
  status: string;
  cost: number;
  working: number;
  sessions: number;
  turns: number;
  reading: { implement: number; review: number; all: number };
  calls: { extract: number; around: number; read: number; refused: number };
  /** Fresh starts by the rule, and delegations that were over the threshold. */
  fresh: { fires: number; would: number };
};

/** `<prefix>-<task>-<arm>-<n>` into its task and arm. */
export const taskArm = (name: string): { task: string; arm: string } => {
  const parts = name.split("-");
  return { task: parts.at(-3) ?? "", arm: parts.at(-2) ?? "" };
};

type Calls = Record<
  string,
  Record<string, { calls: number; refused: number; weight: number }>
>;

/** A row from a benchmark's name, its summary and its carried report. */
export const rowOf = (
  name: string,
  summary: Record<string, unknown>,
  carried: { calls_by_role: Calls; turns: { median: number } },
): Row => {
  const reading = { implement: 0, review: 0, all: 0 };
  const calls = { extract: 0, around: 0, read: 0, refused: 0 };
  for (const [role, kinds] of Object.entries(carried.calls_by_role)) {
    const group = groupOf(role);
    for (const [kind, k] of Object.entries(kinds)) {
      calls.refused += k.refused;
      if (!READING.has(kind)) continue;
      reading.all += k.weight;
      if (group !== "other") reading[group] += k.weight;
      if (kind === "extract") calls.extract += k.calls;
      else if (kind === "Read") calls.read += k.calls;
      else if (AROUND.has(kind)) calls.around += k.calls;
    }
  }
  const sessions = rec(summary["fresh_sessions"]);
  return {
    name,
    ...taskArm(name),
    run: text(summary["run"]) ?? "",
    status: text(summary["status"]) ?? "",
    cost: r2(count(summary["cost_usd"])),
    working: r1(count(rec(summary["minutes"])["working"])),
    sessions: count(summary["sessions"]),
    turns: carried.turns.median,
    reading,
    calls,
    fresh: {
      fires: count(sessions["fires"]),
      would: count(sessions["would_fires"]),
    },
  };
};

const median = (xs: readonly number[]): number => {
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] ?? 0)
    : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

const line = (cells: readonly (string | number)[]): string =>
  `| ${cells.join(" | ")} |`;

const k = (n: number): string => `${r1(n / 1000).toLocaleString("en")}k`;

/** The runs table, then each task and arm's medians. */
export const armsMarkdown = (rows: readonly Row[]): string => {
  const head =
    "| Task | Arm | Run | Status | Cost | Working min | Sessions | Median turns | Reading weight (implement / review / all) | extract / shell reads / Read calls | Refused | Fresh starts / would-fires |";
  const runs = rows.map(r =>
    line([
      r.task,
      r.arm,
      r.run,
      r.status,
      `$${r.cost.toFixed(2)}`,
      r.working,
      r.sessions,
      r.turns,
      `${k(r.reading.implement)} / ${k(r.reading.review)} / ${k(r.reading.all)}`,
      `${String(r.calls.extract)} / ${String(r.calls.around)} / ${String(r.calls.read)}`,
      r.calls.refused,
      `${String(r.fresh.fires)} / ${String(r.fresh.would)}`,
    ]),
  );
  const groups = [...new Set(rows.map(r => `${r.task}\u0000${r.arm}`))];
  const medians = groups.map(g => {
    const [task = "", arm = ""] = g.split("\u0000");
    const of = rows.filter(r => r.task === task && r.arm === arm);
    const m = (pick: (r: Row) => number): number =>
      median(of.map(r => pick(r)));
    return line([
      task,
      arm,
      String(of.length),
      `$${m(r => r.cost).toFixed(2)}`,
      r1(m(r => r.working)),
      r1(m(r => r.turns)),
      `${k(m(r => r.reading.implement))} / ${k(m(r => r.reading.review))} / ${k(m(r => r.reading.all))}`,
      `${String(m(r => r.calls.extract))} / ${String(m(r => r.calls.around))} / ${String(m(r => r.calls.read))}`,
      `${String(m(r => r.fresh.fires))} / ${String(m(r => r.fresh.would))}`,
    ]);
  });
  return [
    "## Runs",
    "",
    head,
    `|${" --- |".repeat(12)}`,
    ...runs,
    "",
    "## Medians",
    "",
    "| Task | Arm | Runs | Cost | Working min | Median turns | Reading weight (implement / review / all) | extract / shell reads / Read calls | Fresh starts / would-fires |",
    `|${" --- |".repeat(9)}`,
    ...medians,
    "",
  ].join("\n");
};

const USAGE =
  "Usage: pnpm benchmark:arms <folder> <name>... [--json] [--db <state.db>] [--home <dir>]";

const run = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      db: { type: "string" },
      home: { type: "string" },
    },
  });
  const [folder, ...names] = positionals;
  if (folder === undefined || names.length === 0) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const copy = await copyStore(
    values.db ?? path.join(homedir(), ".ork", "state.db"),
  );
  try {
    const db = new DatabaseSync(copy, { readOnly: true });
    const rows = names.map(name => {
      const summary = rec(
        parse(readFileSync(path.join(folder, name, "summary.json"), "utf8")),
      );
      const carried = carriedReport(
        loadTree(db, text(summary["run"]) ?? ""),
        values.home ?? homedir(),
      );
      if (carried === null) throw new Error(`${name}: no transcripts found`);
      return rowOf(name, summary, carried);
    });
    db.close();
    console.log(
      values.json === true
        ? JSON.stringify(rows, undefined, 2)
        : armsMarkdown(rows),
    );
  } finally {
    rmSync(path.dirname(copy), { recursive: true, force: true });
  }
};

if (import.meta.main) await run();
