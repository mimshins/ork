/**
 * @file How the onboarding survey reads a repository's files: only what
 *   resolves inside the repository (a link out of it is not followed), only
 *   small plain files, names cut to a length and lists to a count. Its pieces:
 *   CI files, the tools' agent and skill folders, and what `.ork/` holds.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

import { AGENT_TOOL_LAYOUTS, ORK_LAYOUT } from "@krapht/ork-integrations";

import { capped, oneLine } from "./text.ts";

const MAX_FILE_BYTES = 256 * 1024;
/** How many names of one kind the survey keeps. */
export const MAX_NAMES = 20;

export type AgentFolder = {
  /** Project-relative, e.g. `.claude/skills`. */
  folder: string;
  entries: string[];
  /** Entries left out for the size limit. */
  more: number;
};

export type OrkHolds = {
  exists: boolean;
  projectFile: boolean;
  /** Workflow file names without `.ork.yaml`. */
  workflows: string[];
  agents: string[];
  skills: string[];
};

/** `path.join(root, ...parts)`, resolved, when it lies inside `root`, else null. */
export const insideRoot = (root: string, ...parts: string[]): string | null => {
  try {
    const real = realpathSync(path.join(root, ...parts));
    const base = realpathSync(root);
    return real === base || real.startsWith(base + path.sep) ? real : null;
  } catch {
    return null;
  }
};

/** A small plain file's text, or null: missing, too big, or out of the root. */
export const readText = (root: string, ...parts: string[]): string | null => {
  const file = insideRoot(root, ...parts);
  if (file === null) return null;
  const stats = statSync(file);
  return stats.isFile() && stats.size <= MAX_FILE_BYTES
    ? readFileSync(file, "utf8")
    : null;
};

type Entry = { name: string; dir: boolean };

/** A folder's real path and entries, or null: missing, not a folder, or out. */
const entriesOf = (
  root: string,
  ...parts: string[]
): { real: string; names: Entry[] } | null => {
  const real = insideRoot(root, ...parts);
  if (real === null || !statSync(real).isDirectory()) return null;
  return {
    real,
    names: readdirSync(real, { withFileTypes: true })
      .map(e => ({
        name: e.name,
        dir:
          e.isDirectory() ||
          (e.isSymbolicLink() &&
            insideRoot(root, ...parts, e.name) !== null &&
            statSync(path.join(real, e.name)).isDirectory()),
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  };
};

const CI_FILES = [
  ".gitlab-ci.yml",
  ".circleci/config.yml",
  "Jenkinsfile",
  "azure-pipelines.yml",
  ".buildkite/pipeline.yml",
  "bitbucket-pipelines.yml",
];

/** CI configuration files, project-relative. */
export const ciFilesOf = (root: string): string[] => {
  const github =
    entriesOf(root, ".github", "workflows")
      ?.names.filter(e => !e.dir && /\.ya?ml$/u.test(e.name))
      .map(e => `.github/workflows/${oneLine(e.name, 80)}`) ?? [];
  const others = CI_FILES.filter(file => insideRoot(root, file) !== null);
  return capped([...github, ...others], MAX_NAMES).shown;
};

/** The tools' agent and skill folders that hold something, `.ork/` first. */
export const agentFoldersOf = (root: string): AgentFolder[] => {
  const seen = new Set<string>();
  const folders: AgentFolder[] = [];
  for (const layout of [ORK_LAYOUT, ...AGENT_TOOL_LAYOUTS]) {
    for (const [folder, dirs] of [
      [layout.agents, false],
      [layout.skills, true],
    ] as const) {
      if (folder === undefined) continue;
      const found = entriesOf(root, ...folder.split("/"));
      // A tool's folder linked to `.ork/` (`ork link`) lists once.
      if (found === null || seen.has(found.real)) continue;
      seen.add(found.real);
      const names = found.names
        .filter(e => (dirs ? e.dir : !e.dir && e.name.endsWith(".md")))
        .map(e => oneLine(e.name.replace(/\.md$/u, ""), 60));
      if (names.length === 0) continue;
      const { shown, more } = capped(names, MAX_NAMES);
      folders.push({ folder, entries: shown, more });
    }
  }
  return folders;
};

/** What `.ork/` holds. */
export const orkOf = (root: string): OrkHolds => {
  const names = (folder: string, dirs: boolean, suffix: string): string[] =>
    capped(
      (entriesOf(root, ".ork", folder)?.names ?? [])
        .filter(e => (dirs ? e.dir : !e.dir && e.name.endsWith(suffix)))
        .map(e => oneLine(e.name.slice(0, e.name.length - suffix.length), 60)),
      MAX_NAMES,
    ).shown;
  return {
    exists: existsSync(path.join(root, ".ork")),
    projectFile: insideRoot(root, ".ork", "project.yaml") !== null,
    workflows: names("workflows", false, ".ork.yaml"),
    agents: names("agents", false, ".md"),
    skills: names("skills", true, ""),
  };
};
