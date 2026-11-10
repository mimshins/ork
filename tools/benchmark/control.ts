/**
 * @file `pnpm benchmark:control <folder>`: a rough control for the benchmarks
 *   in a folder, what each change would cost in plain Claude Code sessions on
 *   this machine (their CLAUDE.md, MCP servers, memory, user settings,
 *   subagents), from this repository's own transcripts (transcripts.ts). The
 *   unit is a push window: one session's work between two of its pushes, with
 *   the commits that push carried, in git-changed lines without generated
 *   files. A benchmark's estimate is its `result_commits`' lines at the window
 *   rates' line-weighted quartiles. Writes `control.json` and `CONTROL.md` into
 *   the folder.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { controlMarkdown, type Estimate, type Rate } from "./control-report.ts";
import { count, expandHome, parse, r1, r2, rec, text } from "./json.ts";
import { readSessions, type Session, transcriptsOf } from "./transcripts.ts";

/** Files a tool generated or wrote, which no session wrote. */
const GENERATED = [
  /(^|\/)pnpm-lock\.yaml$/u,
  /workflow\.schema\.json$/u,
  /CHANGELOG\.md$/u,
  /(^|\/)dist\//u,
  /__build_info__\.ts$/u,
];

/** The value at quantile `q`, each value counted `weight` times. */
export const weightedQuantile = (
  items: readonly { value: number; weight: number }[],
  q: number,
): number => {
  const sorted = items.toSorted((a, b) => a.value - b.value);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  let seen = 0;
  for (const x of sorted) {
    seen += x.weight;
    if (seen >= q * total) return x.value;
  }
  return sorted.at(-1)?.value ?? Number.NaN;
};

type Window = {
  session: string;
  push: string;
  at: string;
  commits: number;
  lines: number;
  usd: number;
  working_min: number;
};

const createGit = (repo: string) => {
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  const cache = new Map<string, number>();
  const linesOf = (sha: string): number => {
    const known = cache.get(sha);
    if (known !== undefined) return known;
    const n = git("show", "--numstat", "--format=", sha)
      .split("\n")
      .map(line => line.split("\t"))
      .filter(([add, , file]) => file !== undefined && add !== "-")
      .filter(([, , file]) => !GENERATED.some(g => g.test(file ?? "")))
      .reduce((s, [add, del]) => s + Number(add) + Number(del), 0);
    cache.set(sha, n);
    return n;
  };
  return { git, linesOf };
};

/** Each session's work between its pushes, the first to print a push owning it. */
const windowsOf = (
  sessions: readonly Session[],
  { git, linesOf }: ReturnType<typeof createGit>,
  excluded: ReadonlySet<string>,
): Window[] => {
  const owner = new Map<string, { session: string; at: number }>();
  for (const s of sessions) {
    for (const p of s.pushes) {
      const key = `${p.from}..${p.to}`;
      const known = owner.get(key);
      if (known === undefined || p.at < known.at)
        owner.set(key, { session: s.id, at: p.at });
    }
  }
  return sessions.flatMap(s => {
    let from = Number.NEGATIVE_INFINITY;
    const mine = s.pushes
      .filter(p => owner.get(`${p.from}..${p.to}`)?.session === s.id)
      .filter((p, i, all) => all.findIndex(q => q.to === p.to) === i)
      .toSorted((a, b) => a.at - b.at);
    return mine.flatMap(p => {
      let shas: string[] = [];
      try {
        shas = git("rev-list", `${p.from}..${p.to}`)
          .split("\n")
          .filter(Boolean);
      } catch {
        return [];
      }
      const kept = shas.filter(
        sha =>
          !excluded.has(sha) &&
          !git("show", "-s", "--format=%s", sha).startsWith("chore: release"),
      );
      const inside = (at: number) => at > from && at <= p.at;
      const window: Window = {
        session: s.id,
        push: `${p.from}..${p.to}`,
        at: new Date(p.at).toISOString(),
        commits: kept.length,
        lines: kept.reduce((n, sha) => n + linesOf(sha), 0),
        usd: s.messages
          .filter(m => inside(m.at))
          .reduce((t, m) => t + m.usd, 0),
        working_min:
          s.spans.reduce(
            (t, sp) =>
              t +
              Math.max(0, Math.min(sp.end, p.at) - Math.max(sp.start, from)),
            0,
          ) / 60_000,
      };
      from = p.at;
      return [window];
    });
  });
};

/** The benchmarks in a folder: their run, Ork's numbers and their commits. */
const benchmarksIn = (folder: string) =>
  readdirSync(folder, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(folder, d.name, "summary.json"))
    .filter(file => existsSync(file))
    .map(file => {
      const s = rec(parse(readFileSync(file, "utf8")));
      return {
        name: path.basename(path.dirname(file)),
        run: text(s["run"]) ?? "",
        ork_usd: count(s["cost_usd"]),
        ork_working_min: count(rec(s["minutes"])["working"]),
        commits: Array.isArray(s["result_commits"])
          ? s["result_commits"].map(c => text(c)).filter(c => c !== undefined)
          : [],
      };
    });

const quartiles = (windows: readonly Window[], per: (w: Window) => number) =>
  [0.25, 0.5, 0.75].map(q =>
    weightedQuantile(
      windows.map(w => ({ value: (per(w) / w.lines) * 1000, weight: w.lines })),
      q,
    ),
  );

const main = (): void => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { transcripts: { type: "string" }, repo: { type: "string" } },
  });
  const [folder] = positionals;
  if (folder === undefined) {
    console.error(
      "Usage: pnpm benchmark:control <folder> [--transcripts <dir>] [--repo <path>]",
    );
    process.exitCode = 1;
    return;
  }
  const bench = path.resolve(expandHome(folder, homedir()));
  const repo = values.repo ?? process.cwd();
  const git = createGit(repo);
  const benchmarks = benchmarksIn(bench).map(b =>
    Object.assign(b, {
      lines: b.commits.reduce((n, c) => n + git.linesOf(c), 0),
    }),
  );
  const excluded = new Set(
    benchmarks.flatMap(b => b.commits.map(c => git.git("rev-parse", c).trim())),
  );
  const sessions = readSessions(
    values.transcripts ?? transcriptsOf(homedir(), repo),
  );
  const used = windowsOf(sessions, git, excluded).filter(
    w => w.lines > 0 && w.usd > 0,
  );
  if (used.length === 0) {
    console.error("No session pushed commits with a cost record.");
    process.exitCode = 1;
    return;
  }
  const usdK = quartiles(used, w => w.usd);
  const minK = quartiles(used, w => w.working_min);
  const dates = used.map(w => w.at).toSorted();
  const rate: Rate = {
    sessions: new Set(used.map(w => w.session)).size,
    windows: used.length,
    commits: used.reduce((s, w) => s + w.commits, 0),
    lines: used.reduce((s, w) => s + w.lines, 0),
    usd: r2(used.reduce((s, w) => s + w.usd, 0)),
    working_min: r1(used.reduce((s, w) => s + w.working_min, 0)),
    usd_per_kline: usdK.map(x => r2(x)),
    min_per_kline: minK.map(x => r1(x)),
    from: dates[0]?.slice(0, 10) ?? "",
    to: dates.at(-1)?.slice(0, 10) ?? "",
  };
  const estimates: Estimate[] = benchmarks
    .filter(b => b.lines > 0)
    .map(b =>
      Object.assign(b, {
        manual_usd: usdK.map(x => r2((b.lines / 1000) * x)),
        manual_working_min: minK.map(x => r1((b.lines / 1000) * x)),
      }),
    )
    .toSorted((a, b) => b.lines - a.lines);
  const data = {
    generated: new Date().toISOString(),
    rate,
    estimates,
    windows: used,
  };
  writeFileSync(
    path.join(bench, "control.json"),
    `${JSON.stringify(data, undefined, 2)}\n`,
  );
  const md = controlMarkdown(rate, estimates);
  writeFileSync(path.join(bench, "CONTROL.md"), md);
  console.log(md);
};

if (import.meta.main) main();
