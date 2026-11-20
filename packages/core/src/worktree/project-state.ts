/**
 * @file What a project's checkout holds before a run makes worktrees of it: its
 *   git root and head, and the uncommitted instructions, skills and agents a
 *   worktree (made from the commit) would be missing.
 */

import { existsSync, lstatSync, readlinkSync } from "node:fs";
import path from "node:path";

import { git, gitOk, lines } from "./git.ts";

/** Where the project's instructions, skills and agents live. */
const AGENT_PATHSPECS = [
  ":(glob)**/CLAUDE.md",
  ":(glob)**/AGENTS.md",
  ".claude",
  ".agents",
];

export type ProjectState = {
  root: string;
  /** The commit root nodes branch from. */
  head: string;
  /** Uncommitted instructions, skills or agents (worktrees lack them). */
  dirtyAgentFiles: string[];
  /** How many other paths have uncommitted changes. */
  dirtyOther: number;
};

/** Symlinked agent folders (e.g. `.claude/skills -> ../.ai/skills`), as targets. */
const symlinkTargets = (root: string): string[] => {
  const targets: string[] = [];
  for (const dir of [".claude", ".agents"]) {
    const base = path.join(root, dir);
    if (!existsSync(base) || !lstatSync(base).isDirectory()) continue;
    for (const name of ["skills", "agents", "commands", "rules"]) {
      const link = path.join(base, name);
      if (!existsSync(link) || !lstatSync(link).isSymbolicLink()) continue;
      const target = path.resolve(base, readlinkSync(link));
      const relative = path.relative(root, target);
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
        targets.push(relative);
      }
    }
  }
  return [...new Set(targets)];
};

const statusPaths = async (
  root: string,
  pathspecs: readonly string[],
): Promise<string[]> => {
  const out = await gitOk(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...pathspecs,
  ]);
  return lines(out).map(line => line.slice(3));
};

/** The project's git root, head, and what a worktree would be missing. */
export const inspectProject = async (
  cwd: string,
): Promise<ProjectState | null> => {
  const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return null;
  const root = top.stdout.trim();
  const head = await git(root, ["rev-parse", "HEAD"]);
  if (head.code !== 0) return null;
  const agent = await statusPaths(root, [
    ...AGENT_PATHSPECS,
    ...symlinkTargets(root),
  ]);
  const all = await statusPaths(root, ["."]);
  return {
    root,
    head: head.stdout.trim(),
    dirtyAgentFiles: agent,
    dirtyOther: all.length - agent.length,
  };
};
