/**
 * @file Ork's skills for Claude Code in a project (RFC-012): `ork init
 *   --skills` writes the plugin's skills into `.ork/skills/ork-<name>/`, each
 *   naming the Ork that wrote it, and links Claude Code's skills folder there,
 *   so teammates get them through git. It rewrites Ork's own copies and never a
 *   skill someone else wrote; `ork doctor` says when a copy is older than Ork.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { isNewer, linkTools, type ToolLink } from "@krapht/ork-core";
import { type CheckResult, ORK_LAYOUT } from "@krapht/ork-integrations";

import { ORK_SKILLS } from "./ork-skills.ts";

/** A project copy's folder name: `ork-write` for the plugin's `write`. */
export const SKILL_PREFIX = "ork-";

const STAMP = /^<!-- Ork (\S+) wrote this with `ork init --skills`/mu;

/** The Ork version a copy names, or `null` for a skill Ork didn't write. */
export const stampOf = (text: string): string | null =>
  STAMP.exec(text)?.[1] ?? null;

/**
 * A plugin skill as a project skill: named `ork-<name>`, its references to
 * `/ork:<name>` as `/ork-<name>`, and the Ork that wrote it after its
 * frontmatter.
 */
export const projectSkill = (
  name: string,
  text: string,
  version: string,
): string =>
  text
    .replace(/^name: .*$/mu, `name: ${SKILL_PREFIX}${name}`)
    .replace(
      /^(---\n[\s\S]*?\n---\n)/u,
      `$1\n<!-- Ork ${version} wrote this with \`ork init --skills\`, which rewrites it. To keep your own version, rename its folder. -->\n`,
    )
    .replaceAll("/ork:", `/${SKILL_PREFIX}`);

const fileOf = (root: string, name: string): string =>
  path.join(root, ORK_LAYOUT.skills, `${SKILL_PREFIX}${name}`, "SKILL.md");

const sameFolder = (a: string, b: string): boolean => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
};

export type SkillsResult = {
  created: string[];
  updated: string[];
  /** Ork's copies that were current, and skills Ork didn't write. */
  skipped: string[];
  links: ToolLink[];
};

/**
 * Writes Ork's skills into the project at `root`, and links Claude Code's
 * folder.
 */
export const writeSkills = (
  root: string,
  version: string,
  options: { link: boolean },
): SkillsResult => {
  const result: SkillsResult = {
    created: [],
    updated: [],
    skipped: [],
    links: [],
  };
  for (const [name, text] of Object.entries(ORK_SKILLS)) {
    const file = fileOf(root, name);
    const shown = path.relative(root, file);
    const wanted = projectSkill(name, text, version);
    const current = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (current !== null && (current === wanted || stampOf(current) === null)) {
      result.skipped.push(shown);
    } else {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, wanted);
      (current === null ? result.created : result.updated).push(shown);
    }
  }
  const claude = path.join(root, ".claude", "skills");
  const ork = path.join(root, ORK_LAYOUT.skills);
  if (options.link && !sameFolder(claude, ork)) {
    const linked = linkTools(root, ["claude"]);
    if (linked.ok) {
      result.created.push(...linked.created);
      result.links = linked.links;
    }
  }
  return result;
};

/** Whether the project has Ork's skills, current or not. */
export const hasSkills = (root: string): boolean =>
  Object.keys(ORK_SKILLS).some(name => existsSync(fileOf(root, name)));

/** What `ork doctor` says of the project's copies of Ork's skills. */
export const skillChecks = (root: string, version: string): CheckResult[] => {
  const folder = path.join(root, ORK_LAYOUT.skills);
  if (!existsSync(folder)) return [];
  const old = readdirSync(folder)
    .filter(name => name.startsWith(SKILL_PREFIX))
    .flatMap(name => {
      const file = path.join(folder, name, "SKILL.md");
      const stamp = existsSync(file)
        ? stampOf(readFileSync(file, "utf8"))
        : null;
      return stamp !== null && isNewer(version, stamp)
        ? [`${name} (${stamp})`]
        : [];
    });
  return old.length === 0
    ? []
    : [
        {
          name: "skills",
          status: "warn",
          detail: `older than Ork ${version}: ${old.join(", ")}`,
          hint: "Rewrite them with `ork init --skills`.",
        },
      ];
};
