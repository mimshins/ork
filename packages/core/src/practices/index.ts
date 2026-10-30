/**
 * @file Ork's built-in practices (caveman, ponytail; ADR-021): which ones a
 *   node gets, resolved down the ownership tree, and the text appended to its
 *   session's system prompt unless the project ships the same skill.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import type { Practices, Workflow } from "@krapht/ork-schema";

import { CAVEMAN } from "./caveman.ts";
import { ponytail, type PonytailLevel } from "./ponytail.ts";

export type ResolvedPractices = {
  caveman: boolean;
  ponytail: PonytailLevel | false;
};

const PRACTICE_NAMES = ["caveman", "ponytail"] as const;

/**
 * A node's practices: its own setting, else its nearest owner's, else the
 * workflow's `defaults`, else on (ADR-021). Turning one off on a root node
 * turns it off for everything that node owns.
 */
export const resolvePractices = (
  workflow: Workflow,
  id: string,
): ResolvedPractices => {
  const chain: Practices[] = [];
  const seen = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const node: Workflow["nodes"][string] | undefined = workflow.nodes[current];
    if (node !== undefined && "practices" in node && node.practices) {
      chain.push(node.practices);
    }
    current = node?.parent;
  }
  chain.push(workflow.defaults?.practices ?? {});
  const pick = <K extends keyof Practices>(key: K) =>
    chain.find(p => p[key] !== undefined)?.[key];
  const tail = pick("ponytail") ?? true;
  return {
    caveman: pick("caveman") ?? true,
    ponytail: tail === true ? "full" : tail,
  };
};

/** A practice the project ships itself (e.g. `.claude/skills/caveman/`) wins. */
export const projectHasSkill = (cwd: string, name: string): boolean =>
  [".claude/skills", ".agents/skills"].some(dir =>
    existsSync(path.join(cwd, dir, name, "SKILL.md")),
  );

/** The practice texts to append to a session's system prompt. */
export const practiceInstructions = (
  practices: ResolvedPractices,
  cwd: string,
): { text: string[]; skipped: string[] } => {
  const text: string[] = [];
  const skipped: string[] = [];
  for (const name of PRACTICE_NAMES) {
    if (practices[name] === false) continue;
    if (projectHasSkill(cwd, name)) {
      skipped.push(name);
      continue;
    }
    text.push(
      name === "caveman"
        ? CAVEMAN
        : ponytail(practices.ponytail === false ? "full" : practices.ponytail),
    );
  }
  return { text, skipped };
};
