/**
 * @file The git side of `ork __onboard finish`: which paths the writer changed
 *   (committed on its branch, or still uncommitted or ignored in its worktree;
 *   a write outside the worktree is not seen, nor a local file Ork copied in
 *   and the writer left as it was, nor the empty `.commandcode/taste/taste.md`
 *   command-code leaves), which of them the writer may change, a file's text at
 *   `HEAD`, and the commit of the canonical rewrite. Every argument is Ork's or
 *   validated; nothing the model drafted is run.
 */

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { plainPathInside } from "@krapht/ork-core";

export type Kind = "added" | "modified" | "deleted" | "other";

export type Change = { path: string; kind: Kind };

/** The paths the writer may change: one level of workflows, and the rules. */
const ALLOWED = /^\.ork\/(?:workflows\/[^/]+\.ork\.yaml|project\.yaml)$/u;

export const isAllowedPath = (file: string): boolean => ALLOWED.test(file);

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const kindOf = (letter: string): Kind => {
  if (letter === "A" || letter === "?" || letter === "!") return "added";
  if (letter === "M") return "modified";
  return letter === "D" ? "deleted" : "other";
};

/** `git diff --name-status -z` entries: status, then the path. */
const fromDiff = (out: string): Change[] => {
  const parts = out.split("\0").filter(part => part !== "");
  const changes: Change[] = [];
  for (let at = 0; at + 1 < parts.length; at += 2) {
    changes.push({
      path: parts[at + 1] ?? "",
      kind: kindOf(parts[at]?.[0] ?? ""),
    });
  }
  return changes;
};

/**
 * Whether an ignored file of the worktree is the one `createWorktree` copied
 * from the project root (`CLAUDE.local.md`, what `.worktreeinclude` lists):
 * same path, same bytes. An edited copy, or any other ignored file, is not.
 */
const copiedUnchanged = (
  root: string,
  worktree: string,
  file: string,
): boolean => {
  try {
    return readFileSync(path.join(root, file)).equals(
      readFileSync(path.join(worktree, file)),
    );
  } catch {
    return false;
  }
};

/** The empty file `cmd -p` (command-code) leaves in the folder it runs in. */
const TASTE_FILE = ".commandcode/taste/taste.md";

/**
 * Whether `file` of the worktree is the taste file, new, a regular file (not a
 * link, nor behind one) and empty. Any other path, or content, is not.
 */
const emptyTaste = (worktree: string, file: string): boolean => {
  if (file !== TASTE_FILE) return false;
  const absolute = path.join(worktree, file);
  try {
    if (!plainPathInside(worktree, absolute)) return false;
    const stat = lstatSync(absolute);
    return stat.isFile() && stat.size === 0;
  } catch {
    return false;
  }
};

/**
 * `git status --porcelain=v1 -z` entries: `XY path`, minus copied files and a
 * new empty taste file.
 */
const fromStatus = (
  out: string,
  same: (file: string) => boolean,
  empty: (file: string) => boolean,
): Change[] =>
  out
    .split("\0")
    .filter(entry => entry.length > 3)
    .filter(entry => !(entry.startsWith("!!") && same(entry.slice(3))))
    .filter(
      entry =>
        !(
          (entry.startsWith("!!") || entry.startsWith("??")) &&
          empty(entry.slice(3))
        ),
    )
    .map(entry => {
      const letters = entry.slice(0, 2);
      const kind = letters.includes("D")
        ? "deleted"
        : kindOf(letters.replace(" ", "")[0] ?? "");
      return { path: entry.slice(3), kind };
    });

/**
 * What the branch changed since `HEAD` (run in `root`) and what the worktree
 * still holds uncommitted. A rename is a deletion and an addition.
 */
export const changesOf = (
  root: string,
  worktree: string,
  branch: string,
): Change[] => [
  ...fromDiff(
    git(root, [
      "diff",
      "--name-status",
      "-z",
      "--no-renames",
      `HEAD...${branch}`,
    ]),
  ),
  ...fromStatus(
    git(worktree, [
      "-c",
      "status.renames=false",
      "status",
      "--porcelain=v1",
      "-z",
      "-uall",
      // A file the writer hid in an ignored path is still a change.
      "--ignored",
    ]),
    file => copiedUnchanged(root, worktree, file),
    file => emptyTaste(worktree, file),
  ),
];

/** `file` as of `HEAD` in `root`, or null when it was not there. */
export const textAtHead = (root: string, file: string): string | null => {
  try {
    return git(root, ["show", `HEAD:${file}`]);
  } catch {
    return null;
  }
};

/**
 * Commits `files` in the worktree, its hooks running. Returns the git message
 * when it is refused, else null.
 */
export const commitIn = (
  worktree: string,
  files: readonly string[],
  message: string,
): string | null => {
  try {
    git(worktree, ["add", "--", ...files]);
    git(worktree, ["commit", "-m", message]);
    return null;
  } catch (error) {
    const text =
      error instanceof Error && "stderr" in error
        ? String(error.stderr)
        : String(error);
    return text.trim().split("\n").at(-1) ?? "git refused the commit";
  }
};
