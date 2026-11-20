/**
 * @file Renumbers the RFCs a commit adds when their number is already taken on
 *   a fetched ref, so two RFCs drafted from a stale main never share a number
 *   (`rfcs/README.md`). Usage: `node tools/rfcs/renumber.ts <worktree> <ref>…`,
 *   run on a worktree whose HEAD is the RFC commit, after fetching the refs.
 *   The last ref is the tip the commit is rebased onto. A commit that holds
 *   only new RFCs and their index rows is replayed on that tip, which a rebase
 *   could not do without conflicting on the index table; any other commit is
 *   renumbered in place and left to the caller's rebase. Prints one JSON line
 *   per renumbered RFC on stdout and what it did on stderr.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { pad, renumberIndex, renumberText } from "./index-table.ts";

export { renumberIndex, renumberText };

const README = "rfcs/README.md";

/** An RFC file in `rfcs/`: its name, then its number. */
const RFC_FILE = /^rfcs\/(?:active|archived)\/(RFC-(\d+)-[^/]+\.md)$/u;

/** An RFC file a commit may add. */
const ACTIVE_FILE = /^rfcs\/active\/(RFC-(\d+)-[^/]+\.md)$/u;

/** One RFC the commit adds, and the number it ends up with. */
type Item = {
  readonly from: number;
  readonly to: number;
  readonly file: string;
  readonly newFile: string;
  readonly path: string;
  readonly newPath: string;
  readonly reason: string;
};

/** One renumbered RFC, as the CLI prints it. */
export type Renumbered = {
  readonly from: number;
  readonly to: number;
  readonly path: string;
  readonly reason: string;
};

/** Number to file name of every RFC among `names` (paths in a git tree). */
export const takenNumbers = (names: readonly string[]): Map<number, string> => {
  const taken = new Map<number, string>();
  for (const name of names) {
    const match = RFC_FILE.exec(name);
    const file = match?.[1];
    const number = match?.[2];
    if (file !== undefined && number !== undefined) {
      taken.set(Number(number), file);
    }
  }
  return taken;
};

const git = (cwd: string, args: readonly string[], input?: string): string =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });

/** `[status, path]` of every file HEAD changes. */
const changedFiles = (cwd: string): [string, string][] => {
  const tokens = git(cwd, [
    "diff-tree",
    "--no-commit-id",
    "--name-status",
    "-r",
    "--no-renames",
    "-z",
    "HEAD",
  ])
    .split("\0")
    .filter(token => token !== "");
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    pairs.push([tokens[i] ?? "", tokens[i + 1] ?? ""]);
  }
  return pairs;
};

/** A path from git that stays inside the worktree. */
const inside = (file: string): string => {
  if (path.isAbsolute(file) || file.split("/").includes("..")) {
    throw new Error(`Refusing the path ${file}.`);
  }
  return file;
};

/**
 * The added RFCs in number order with the number each ends up with. From the
 * first number a ref already holds under another file, every RFC takes the next
 * free numbers above the highest on any ref, so they stay consecutive.
 */
const planItems = (
  cwd: string,
  refs: readonly string[],
  added: readonly { path: string; file: string; number: number }[],
): Item[] => {
  const lists = refs.map(ref => ({
    ref,
    taken: takenNumbers(
      git(cwd, [
        "ls-tree",
        "-r",
        "--name-only",
        "--full-name",
        "-z",
        ref,
        "--",
        "rfcs",
      ]).split("\0"),
    ),
  }));
  const sorted = added.toSorted((a, b) => a.number - b.number);
  const first = sorted.findIndex(a =>
    lists.some(({ taken }) => {
      const other = taken.get(a.number);
      return other !== undefined && other !== a.file;
    }),
  );
  let next =
    Math.max(0, ...lists.flatMap(({ taken }) => [...taken.keys()])) + 1;
  const takenOn = lists.find(({ taken }) =>
    taken.has(sorted[first]?.number ?? 0),
  );
  return sorted.map((a, i) => {
    const to = first === -1 || i < first ? a.number : next++;
    const newFile = a.file.replace(`RFC-${pad(a.number)}-`, `RFC-${pad(to)}-`);
    const newPath = `rfcs/active/${newFile}`;
    return {
      from: a.number,
      to,
      file: a.file,
      newFile,
      path: a.path,
      newPath,
      reason:
        i === first
          ? `RFC-${pad(a.number)} is on ${takenOn?.ref ?? ""}`
          : `it follows RFC-${pad(sorted[first]?.number ?? 0)}, which moved`,
    };
  });
};

/**
 * Renumbers the RFCs the HEAD commit of `cwd` adds that clash with a number on
 * one of `refs`. Returns what it changed, in number order; empty when no number
 * clashes (or the same file is already on the ref, as on a resume).
 */
export const renumber = (
  cwd: string,
  refs: readonly string[],
): Renumbered[] => {
  const changes = changedFiles(cwd);
  const added = changes.flatMap(([status, file]) => {
    const match = ACTIVE_FILE.exec(file);
    const name = match?.[1];
    const number = match?.[2];
    return status === "A" && name !== undefined && number !== undefined
      ? [{ path: file, file: name, number: Number(number) }]
      : [];
  });
  const items = added.length === 0 ? [] : planItems(cwd, refs, added);
  const moved = items.filter(item => item.from !== item.to);
  if (moved.length === 0) {
    return [];
  }
  const replay = changes.every(
    ([status, file]) =>
      (status === "A" && ACTIVE_FILE.test(file)) ||
      (status === "M" && file === README),
  );
  const read = (file: string): string =>
    readFileSync(path.join(cwd, inside(file)), "utf8");
  const renameLinks = (text: string): string =>
    moved.reduce((t, i) => t.replaceAll(i.file, i.newFile), text);
  const own = new Map(items.map(item => [item.path, item]));
  // Every file the commit changes, as it must read after the renumbering.
  const texts = new Map<string, string>();
  for (const [status, file] of changes) {
    if (status !== "D" && file !== README) {
      const item = own.get(file);
      const text = read(file);
      texts.set(
        item?.newPath ?? file,
        renameLinks(
          item === undefined ? text : renumberText(text, item.from, item.to),
        ),
      );
    }
  }
  const ourIndex = changes.some(([, file]) => file === README)
    ? read(README)
    : undefined;
  const rows = items.flatMap(item => {
    const row = ourIndex
      ?.split("\n")
      .find(line => line.includes(`(./active/${item.file})`));
    return row === undefined ? [] : [{ item, row }];
  });
  const indexFrom = (base: string): string =>
    rows.reduce(
      (index, { item, row }) =>
        renumberIndex(index, row, item.from, item.to, item.file),
      base,
    );
  const writeAll = (index: string | undefined): void => {
    for (const [file, text] of texts) {
      // The replay tip may hold no active RFC, so `rfcs/active` may not exist.
      mkdirSync(path.dirname(path.join(cwd, inside(file))), {
        recursive: true,
      });
      writeFileSync(path.join(cwd, inside(file)), text);
    }
    if (index !== undefined) {
      writeFileSync(path.join(cwd, README), index);
    }
  };
  const written = [
    ...texts.keys(),
    ...(ourIndex === undefined ? [] : [README]),
  ];
  if (replay) {
    const message = git(cwd, ["log", "-1", "--format=%B"]);
    if (git(cwd, ["status", "--porcelain", "--untracked-files=no"]) !== "") {
      throw new Error("The worktree has uncommitted changes to tracked files.");
    }
    const tip = refs.at(-1) ?? "";
    // Built before the reset: a throw here must leave HEAD where it was.
    const index =
      ourIndex === undefined
        ? undefined
        : indexFrom(git(cwd, ["show", `${tip}:${README}`]));
    git(cwd, ["reset", "--hard", "--quiet", tip]);
    writeAll(index);
    git(cwd, ["add", "--all", "--", ...written]);
    git(cwd, ["commit", "--quiet", "-F", "-"], message);
  } else {
    for (const item of moved) {
      rmSync(path.join(cwd, item.path), { force: true });
    }
    writeAll(ourIndex === undefined ? undefined : indexFrom(ourIndex));
    git(cwd, ["add", "--all", "--", ...written, ...moved.map(i => i.path)]);
    git(cwd, ["commit", "--quiet", "--amend", "--no-edit"]);
  }
  return moved.map(({ from, to, newPath, reason }) => ({
    from,
    to,
    path: newPath,
    reason,
  }));
};

if (import.meta.main) {
  const [worktree, ...refs] = process.argv.slice(2);
  try {
    if (worktree === undefined || refs.length === 0) {
      throw new Error("Usage: node tools/rfcs/renumber.ts <worktree> <ref>…");
    }
    for (const done of renumber(worktree, refs)) {
      console.log(
        JSON.stringify({ from: done.from, to: done.to, path: done.path }),
      );
      console.error(
        `renumbered RFC-${pad(done.from)} to RFC-${pad(done.to)}: ${done.reason}`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
