/**
 * @file Skills on disk: the skills in a folder, a skill's name (its SKILL.md
 *   `name`, else its folder), and what a workflow's skill reference names. The
 *   built-in skills Ork ships are in `builtin-skills.ts`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const SKILL_FILE = "SKILL.md";

/** Where a skill was chosen: lowest to highest precedence. */
export const SKILL_LAYERS = ["user", "project", "workflow", "node"] as const;
export type SkillLayer = (typeof SKILL_LAYERS)[number];

export type Skill = {
  name: string;
  layer: SkillLayer;
  /** The folder holding its SKILL.md; `ork:<name>` for a built-in. */
  dir: string;
  /** A built-in's SKILL.md, which has no folder on disk. */
  text?: string;
  /** The reference that named it, for workflow and node skills. */
  ref?: string;
};

/** The `name:` in a SKILL.md's frontmatter, else the folder's name. */
export const skillName = (dir: string): string => {
  const text = readFileSync(path.join(dir, SKILL_FILE), "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text)?.[1] ?? "";
  const name = /^name:\s*(.+?)\s*$/mu.exec(frontmatter)?.[1];
  return name === undefined
    ? path.basename(dir)
    : name.replaceAll(/^["']|["']$/gu, "");
};

const isDir = (target: string): boolean => {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
};

/** The skills directly inside `folder` (symlinks followed), sorted by name. */
export const skillsIn = (folder: string, layer: SkillLayer): Skill[] => {
  if (!isDir(folder)) return [];
  return readdirSync(folder)
    .map(entry => path.join(folder, entry))
    .filter(dir => isDir(dir) && existsSync(path.join(dir, SKILL_FILE)))
    .map(dir => ({ name: skillName(dir), layer, dir }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
};

export type SkillRef =
  | { kind: "builtin"; name: string }
  | { kind: "path"; path: string }
  | { kind: "invalid"; message: string };

/**
 * A skill reference in `layers.skills` or a node's `skills`: `ork:<name>` for a
 * built-in, or a path to a skill folder relative to the workflow file.
 */
export const parseSkillRef = (ref: string): SkillRef => {
  if (ref.startsWith("ork:")) return { kind: "builtin", name: ref.slice(4) };
  if (ref.startsWith("./") || ref.startsWith("../")) {
    return { kind: "path", path: ref };
  }
  return {
    kind: "invalid",
    message: `"${ref}" is neither a built-in (ork:<name>) nor a path to a skill folder (./…); project skills load by themselves`,
  };
};
