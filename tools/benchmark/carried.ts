/**
 * @file `pnpm benchmark:carried <run>`: the carried weight of a finished run's
 *   Claude Code sessions, the proxy RFC-023 rests on. A tool result stays in
 *   the conversation and is read again by every later turn, so each result
 *   weighs its characters times the turns after the one that made it. The
 *   report gives the weight by role and by kind of call, turns per session and
 *   the calls to `extract`. It is a proxy for cache-read cost, not a cost. It
 *   reads a copy of the store and the sessions' own transcripts (a copy of
 *   neither is written), and its output holds only names of roles and kinds and
 *   numbers: never a path, a command, a file name or any result text. Options:
 *   `--db`, `--home`.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

import { KINDS, type Kind, kindOf } from "./carried-kinds.ts";
import { type Json, parse, r1, rec, records, text } from "./json.ts";
import { transcriptsOf } from "./transcripts.ts";
import { copyStore, loadTree, type Tree } from "./tree.ts";

/** One tool result: its kind, and its weight. */
type Result = { kind: Kind; weight: number; returned: number | null };

/** One session's turns and what its tool results weigh. */
export type Carried = { turns: number; results: Result[] };

/**
 * What the `extract` tool ends each result with, and the part we read. Anchored
 * to the end, so a footer-looking line inside the extract is not taken.
 */
const FOOTER = /\[extract: read \d+ characters, returned (\d+)\]$/u;

/** The characters of a tool result's content (a string or its text parts). */
const charsOf = (content: unknown): { chars: number; text: string } => {
  const body =
    text(content) ??
    records(content)
      .map(part => text(part["text"]) ?? "")
      .join("");
  return { chars: body.length, text: body };
};

/**
 * Weighs a transcript's tool results. Claude Code logs a message once per
 * content block, so a turn is a message id's first appearance; a result made on
 * turn t of N weighs its characters times N - t.
 */
export const carriedOf = (entries: readonly Json[]): Carried => {
  const turnOf = new Map<string, number>();
  const calls = new Map<
    string,
    { turn: number; kind: Kind; extract: boolean }
  >();
  const results: { id: string; chars: number; returned: number | null }[] = [];
  for (const e of entries) {
    const m = rec(e["message"]);
    if (e["isSidechain"] === true) continue;
    if (e["type"] === "assistant" && text(m["model"]) !== "<synthetic>") {
      const key =
        text(m["id"]) ?? text(e["requestId"]) ?? text(e["uuid"]) ?? "";
      if (!turnOf.has(key)) turnOf.set(key, turnOf.size + 1);
      for (const block of records(m["content"])) {
        const id = text(block["id"]);
        if (block["type"] !== "tool_use" || id === undefined) continue;
        const name = text(block["name"]) ?? "";
        calls.set(id, {
          turn: turnOf.get(key) ?? 0,
          kind: kindOf(name, rec(block["input"])),
          extract: name === "mcp__ork__extract",
        });
      }
    } else if (e["type"] === "user") {
      for (const block of records(m["content"])) {
        if (block["type"] !== "tool_result") continue;
        const { chars, text: body } = charsOf(block["content"]);
        const footer = FOOTER.exec(body.trimEnd());
        results.push({
          id: text(block["tool_use_id"]) ?? "",
          chars,
          returned: footer === null ? null : Number(footer[1]),
        });
      }
    }
  }
  const turns = turnOf.size;
  return {
    turns,
    results: results.flatMap(r => {
      const call = calls.get(r.id);
      return call === undefined
        ? []
        : [
            {
              kind: call.kind,
              weight: r.chars * (turns - call.turn),
              returned: call.extract ? (r.returned ?? r.chars) : null,
            },
          ];
    }),
  };
};

const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : r1(sum(xs) / xs.length);
const median = (xs: readonly number[]): number => {
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] ?? 0)
    : r1(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
};

/** A weight and its share of the total, as a percent. */
const part = (weight: number, total: number) => ({
  weight,
  share_percent: total === 0 ? 0 : r1((weight / total) * 100),
});

/** One session of a role: what it carried. */
export type RoleSession = { role: string; carried: Carried };

/** The report: weight by role and kind, turns, and `extract` use. */
export const report = (
  sessions: readonly RoleSession[],
  missing: Readonly<Record<string, number>> = {},
) => {
  const total = sum(
    sessions.flatMap(s => s.carried.results.map(r => r.weight)),
  );
  const roles = [...new Set(sessions.map(s => s.role))].toSorted();
  const weightOf = (pick: (s: RoleSession) => boolean, kind?: Kind): number =>
    sum(
      sessions
        .filter(s => pick(s))
        .flatMap(s => s.carried.results)
        .filter(r => kind === undefined || r.kind === kind)
        .map(r => r.weight),
    );
  const turns = (list: readonly RoleSession[]) => ({
    mean: mean(list.map(s => s.carried.turns)),
    median: median(list.map(s => s.carried.turns)),
  });
  const returned = sessions
    .flatMap(s => s.carried.results)
    .filter(r => r.returned !== null);
  return {
    sessions: sessions.length,
    missing_transcripts: missing,
    total_weight: total,
    by_role: Object.fromEntries(
      roles.map(role => [
        role,
        part(
          weightOf(s => s.role === role),
          total,
        ),
      ]),
    ),
    by_kind: Object.fromEntries(
      KINDS.map(kind => [
        kind,
        part(
          weightOf(() => true, kind),
          total,
        ),
      ]),
    ),
    turns: Object.assign(turns(sessions), {
      by_role: Object.fromEntries(
        roles.map(role => [role, turns(sessions.filter(s => s.role === role))]),
      ),
    }),
    extract: {
      calls: returned.length,
      characters_returned: sum(returned.map(r => r.returned ?? 0)),
    },
  };
};

/**
 * A node id without its instance suffix: `implement-2` is `implement`, and a
 * fan-out item `review.1` is `review`.
 */
const roleOf = (workflow: string, node: string): string =>
  `${workflow}.${node.replace(/[-.]\d+$/u, "")}`;

/** The Claude Code sessions a tree started, once each, not forks. */
const sessionsOf = (tree: Tree) => {
  const seen = new Set<string>();
  const found: { id: string; cwd: string; role: string }[] = [];
  for (const e of tree.events) {
    const inner = rec(e.data["event"]);
    const id = text(inner["sessionId"]);
    const cwd = text(inner["cwd"]);
    const driver = inner["driver"];
    if (e.type !== "node.event" || text(inner["type"]) !== "session.started") {
      continue;
    }
    if (id === undefined || cwd === undefined || seen.has(id)) continue;
    if (inner["fork"] === true) continue;
    if (driver !== undefined && driver !== "claude-code") continue;
    seen.add(id);
    const workflow = tree.runs.find(r => r.id === e.run)?.workflow ?? "";
    found.push({ id, cwd, role: roleOf(workflow, e.node ?? "") });
  }
  return found;
};

/** The carried-weight report of a tree, or null when no transcript is found. */
export const carriedReport = (tree: Tree, home: string) => {
  const sessions: RoleSession[] = [];
  const missing: Record<string, number> = {};
  for (const s of sessionsOf(tree)) {
    const file = path.join(transcriptsOf(home, s.cwd), `${s.id}.jsonl`);
    if (existsSync(file)) {
      const entries = readFileSync(file, "utf8")
        .split("\n")
        .map(line => parse(line))
        .filter(e => e !== undefined)
        .map(e => rec(e));
      sessions.push({ role: s.role, carried: carriedOf(entries) });
    } else missing[s.role] = (missing[s.role] ?? 0) + 1;
  }
  return sessions.length === 0 ? null : report(sessions, missing);
};

const USAGE =
  "Usage: pnpm benchmark:carried <run> [--db <state.db>] [--home <dir>]";

const run = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { db: { type: "string" }, home: { type: "string" } },
  });
  const [id] = positionals;
  if (id === undefined) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const copy = await copyStore(
    values.db ?? path.join(homedir(), ".ork", "state.db"),
  );
  try {
    const db = new DatabaseSync(copy, { readOnly: true });
    const tree = loadTree(db, id);
    db.close();
    const result = carriedReport(tree, values.home ?? homedir());
    if (result === null) {
      console.error("No transcripts found for this run's sessions.");
      process.exitCode = 1;
    } else console.log(JSON.stringify(result, undefined, 2));
  } finally {
    rmSync(path.dirname(copy), { recursive: true, force: true });
  }
};

if (import.meta.main) await run();
