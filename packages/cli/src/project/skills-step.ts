/**
 * @file The skills step of `ork init` (RFC-012): with `--skills` it writes
 *   Ork's skills for Claude Code into the project, with `--no-skills` it
 *   doesn't, and otherwise it asks on a terminal, once, saying the plugin has
 *   them too, or says how to add them later.
 */

import { ORK_VERSION } from "../__build_info__.ts";
import { confirm, style, write } from "../output.ts";
import { hasSkills, writeSkills } from "./init-skills.ts";
import { formatLinks } from "./link.ts";

const QUESTION =
  "Add Ork's skills for Claude Code to .ork/skills/, so it writes workflows Ork accepts? Ork's Claude Code plugin has them too. [y/N] ";

const HINT =
  "Ork's skills for Claude Code: add them here with `ork init --skills`, or install Ork's plugin in Claude Code (/plugin marketplace add mimshins/ork, then /plugin install ork@ork).";

/** Whether to write the skills: as asked, or the person's answer. */
const wanted = (
  root: string,
  asked: boolean | undefined,
): Promise<boolean | null> => {
  if (asked !== undefined) return Promise.resolve(asked);
  // Asked once: a project that has them refreshes them with `--skills`.
  if (hasSkills(root)) return Promise.resolve(false);
  return process.stdin.isTTY && process.stdout.isTTY
    ? confirm(QUESTION)
    : Promise.resolve(null);
};

export const skillsStep = async (
  root: string,
  options: { skills: boolean | undefined; link: boolean },
): Promise<void> => {
  const choice = await wanted(root, options.skills);
  if (choice === null) {
    write(style("dim", HINT));
    return;
  }
  if (!choice) return;
  const result = writeSkills(root, ORK_VERSION, { link: options.link });
  for (const item of result.created)
    write(`${style("green", "created")} ${item}`);
  for (const item of result.updated)
    write(`${style("green", "updated")} ${item}`);
  for (const item of result.skipped)
    write(`${style("dim", "exists")}  ${item}`);
  for (const item of result.newer)
    write(
      `${style("yellow", "kept")}    ${item}, from a newer Ork than ${ORK_VERSION}`,
    );
  for (const line of formatLinks(
    result.links.filter(l => l.state !== "linked"),
  )) {
    write(line);
  }
};
