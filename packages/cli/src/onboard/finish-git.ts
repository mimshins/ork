/**
 * @file The git side of `ork __onboard finish`: which paths the writer changed
 *   (committed on its branch, or still uncommitted in its worktree), which of
 *   them the writer may change, a file's text at `HEAD`, and the commit of the
 *   canonical rewrite. Every argument is Ork's or validated; nothing the model
 *   drafted is run.
 */

import { execFileSync } from "node:child_process";

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
  if (letter === "A" || letter === "?") return "added";
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

/** `git status --porcelain=v1 -z` entries: `XY path`. */
const fromStatus = (out: string): Change[] =>
  out
    .split("\0")
    .filter(entry => entry.length > 3)
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
    ]),
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
