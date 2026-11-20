/**
 * @file Renumbers the ADRs and the gap, limit and chore ids a change adds when
 *   a fetched ref already uses them, so builds made at once from the same main
 *   never publish two `ADR-107`s or two `L490`s (`decisions/README.md`,
 *   `specs/gaps.md`). Usage: `node tools/decisions/renumber.ts <worktree>
 *   <ref>…`, run after fetching the refs and before rebasing onto the last one.
 *   The change is the commits of the worktree's HEAD that no ref holds. Each
 *   added ADR that moves is renamed with `git mv`, and its title, its index row
 *   (rows kept in number order) and the links and mentions on the lines the
 *   change adds are rewritten; each moved id is rewritten on those lines and
 *   the register's "next id" line raised past it. The result is amended into
 *   HEAD, left for the caller's rebase. Prints one JSON line per move on stdout
 *   and what it did on stderr; prints nothing when nothing clashes.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { pad } from "../rfcs/index-table.ts";
import {
  adrOf,
  type AdrMove,
  orderAdrRows,
  planAdrs,
  renumberAdrLine,
  takenAdrs,
} from "./adrs.ts";
import {
  addedLines,
  changeOf,
  git,
  grepLines,
  inside,
  showFile,
  treeFiles,
} from "./change.ts";
import {
  bumpNextIds,
  byId,
  definitionsOf,
  GAP_ENTRY_PATTERN,
  type GapDef,
  type GapMove,
  nextIdsOf,
  planGapIds,
  renumberGapLine,
} from "./gap-ids.ts";

const INDEX = "decisions/README.md";
const REGISTER = "specs/gaps.md";
const REGISTER_PATHS = [REGISTER, "specs/gaps"];

/** One move, as the command prints it. */
export type Renumbered =
  | {
      readonly kind: "adr";
      readonly from: number;
      readonly to: number;
      readonly path: string;
      readonly reason: string;
    }
  | {
      readonly kind: "gap";
      readonly from: string;
      readonly to: string;
      readonly reason: string;
    };

/** The entries `ref` defines under `paths`. */
const defsOn = (cwd: string, ref: string, paths: readonly string[]): GapDef[] =>
  definitionsOf(grepLines(cwd, ref, GAP_ENTRY_PATTERN, paths));

/** The added ADRs that move. */
const adrMoves = (
  cwd: string,
  refs: readonly string[],
  touched: readonly { status: string; path: string }[],
): AdrMove[] => {
  const added = touched.flatMap(({ status, path: file }) => {
    const adr = status === "A" ? adrOf(file) : undefined;
    return adr === undefined ? [] : [adr];
  });
  if (added.length === 0) {
    return [];
  }
  const ours = new Set(added.map(adr => adr.path));
  return planAdrs(
    added,
    refs.map(ref => ({
      ref,
      taken: takenAdrs(treeFiles(cwd, ref, "decisions")),
    })),
    takenAdrs(
      treeFiles(cwd, "HEAD", "decisions").filter(name => !ours.has(name)),
    ),
  );
};

/** The register entries the change adds, and those that move. */
const gapMoves = (
  cwd: string,
  refs: readonly string[],
  base: string,
  touched: readonly { status: string; path: string }[],
): { added: GapDef[]; moves: GapMove[] } => {
  const inRegister = touched.some(
    ({ status, path: file }) =>
      status !== "D" && (file === REGISTER || file.startsWith("specs/gaps/")),
  );
  if (!inRegister) {
    return { added: [], moves: [] };
  }
  const before = new Set(defsOn(cwd, base, ["specs"]).map(def => def.id));
  const added = defsOn(cwd, "HEAD", REGISTER_PATHS).filter(
    def => !before.has(def.id),
  );
  if (added.length === 0) {
    return { added, moves: [] };
  }
  const kept = defsOn(cwd, "HEAD", ["specs"]).filter(
    def => !added.some(a => a.id === def.id && a.line === def.line),
  );
  const moves = planGapIds(
    added,
    refs.map(ref => ({
      ref,
      defs: byId(defsOn(cwd, ref, ["specs"])),
      next: nextIdsOf(showFile(cwd, ref, REGISTER) ?? ""),
    })),
    kept,
  );
  return { added, moves };
};

/**
 * Renumbers the ADRs and gap ids the change in `cwd` adds that clash with one
 * of `refs`, and amends HEAD. Returns what moved; empty when nothing clashes
 * (or the same files and entries are already on a ref, as on a resume).
 */
export const renumber = (
  cwd: string,
  refs: readonly string[],
): Renumbered[] => {
  const change = changeOf(cwd, refs);
  if (change === undefined) {
    return [];
  }
  const { base, files } = change;
  const adrs = adrMoves(cwd, refs, files);
  const gaps = gapMoves(cwd, refs, base, files);
  if (adrs.length === 0 && gaps.moves.length === 0) {
    return [];
  }
  if (git(cwd, ["status", "--porcelain", "--untracked-files=no"]) !== "") {
    throw new Error("The worktree has uncommitted changes to tracked files.");
  }
  // A bare `ADR-107` or `L524` stands for the moved one only when nothing else
  // of the change or its base can have that number.
  const baseAdrs = takenAdrs(treeFiles(cwd, base, "decisions"));
  const adrBare = (file: string) => (from: number) => {
    const same = adrs.filter(move => move.number === from);
    const own = adrs.find(move => move.path === file && move.number === from);
    const only = same.length === 1 && !baseAdrs.has(from) ? same[0] : undefined;
    return (own ?? only)?.to;
  };
  const gapBare = (id: string): string | undefined => {
    const same = gaps.added.filter(def => def.id === id);
    const move = gaps.moves.find(m => m.id === id);
    return same.length === 1 ? move?.to : undefined;
  };
  const renamed = new Map(adrs.map(move => [move.path, move.newPath]));
  for (const move of adrs) {
    git(cwd, ["mv", inside(move.path), inside(move.newPath)]);
  }
  // `git mv` has staged the renames; what is rewritten is added below.
  const written = new Set<string>();
  for (const { status, path: file } of files) {
    if (status === "D") {
      continue;
    }
    const at = renamed.get(file) ?? file;
    const full = path.join(cwd, inside(at));
    const text = readFileSync(full, "utf8");
    const lines = addedLines(cwd, base, file);
    const index = file === INDEX;
    const out = text
      .split("\n")
      .map((line, i) =>
        lines.has(i + 1)
          ? renumberGapLine(
              renumberAdrLine(line, adrs, adrBare(file), index),
              gaps.moves,
              gapBare,
            )
          : line,
      )
      .join("\n");
    const result = index && out !== text ? orderAdrRows(out) : out;
    if (result !== text) {
      writeFileSync(full, result);
      written.add(at);
    }
  }
  const wanted = new Map<string, number>();
  for (const move of gaps.moves) {
    const number = Number(move.to.slice(1)) + 1;
    wanted.set(move.letter, Math.max(wanted.get(move.letter) ?? 0, number));
  }
  const register = path.join(cwd, REGISTER);
  const registerText = showFile(cwd, "HEAD", REGISTER);
  if (registerText !== undefined && wanted.size > 0) {
    const text = readFileSync(register, "utf8");
    const bumped = bumpNextIds(text, wanted);
    if (bumped !== text) {
      writeFileSync(register, bumped);
      written.add(REGISTER);
    }
  }
  git(cwd, ["add", "--all", "--", ...written, ...renamed.values()]);
  git(cwd, ["commit", "--quiet", "--amend", "--no-edit"]);
  return [
    ...adrs.map((move): Renumbered => ({
      kind: "adr",
      from: move.number,
      to: move.to,
      path: move.newPath,
      reason: move.reason,
    })),
    ...gaps.moves.map((move): Renumbered => ({
      kind: "gap",
      from: move.id,
      to: move.to,
      reason: move.reason,
    })),
  ];
};

/** What the command prints on stderr for one move. */
const describe = (done: Renumbered): string =>
  done.kind === "adr"
    ? `renumbered ADR-${pad(done.from)} to ADR-${pad(done.to)}: ${done.reason}`
    : `renumbered ${done.from} to ${done.to}: ${done.reason}`;

if (import.meta.main) {
  const [worktree, ...refs] = process.argv.slice(2);
  try {
    if (worktree === undefined || refs.length === 0) {
      throw new Error(
        "Usage: node tools/decisions/renumber.ts <worktree> <ref>…",
      );
    }
    for (const done of renumber(worktree, refs)) {
      const { reason: _reason, ...line } = done;
      console.log(JSON.stringify(line));
      console.error(describe(done));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
