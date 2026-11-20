/**
 * @file What `ork link` and `ork doctor` say about a project's tool folders:
 *   one line per folder (linked, created, kept as a real folder, pointing
 *   elsewhere, broken), and one doctor check per tool the project uses, only
 *   once the project has `.ork/`.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { type ToolLink, toolLinks, toolsInUse } from "@krapht/ork-core";
import {
  AGENT_TOOL_LAYOUTS,
  type CheckResult,
  ORK_LAYOUT,
} from "@krapht/ork-integrations";

import { style } from "../output.ts";

const DESCRIBE: Record<ToolLink["state"], (link: ToolLink) => string> = {
  linked: link => `${link.path} → ${link.origin}`,
  missing: link => `${link.path} → ${link.origin}`,
  broken: link => `${link.path} → ${link.target ?? "?"}, which does not exist`,
  elsewhere: link => `${link.path} → ${link.target ?? "?"}, not ${link.origin}`,
  folder: link => `${link.path} is a real folder, left as it is`,
};

const describe = (link: ToolLink): string => DESCRIBE[link.state](link);

/** Labels are made when used, so `--plain` (set after load) is read. */
const LABEL: Record<ToolLink["state"], () => string> = {
  linked: () => style("dim", "ok     "),
  missing: () => style("yellow", "missing"),
  broken: () => style("red", "broken "),
  elsewhere: () => style("yellow", "kept   "),
  folder: () => style("yellow", "kept   "),
};

/**
 * Said by `ork init` and `ork migrate --agents` when they link tool folders or
 * write skills: those folders are read by every contributor's own agent tool.
 */
export const LINK_WARNING =
  "Linked tool folders (.claude/agents and so on) and .ork/skills reach every contributor's own agent tool, not only Ork's runs. Use --no-link and --no-skills to keep them out.";

/** Names a contributor's own agent tool reads as instructions. */
const KNOWLEDGE_FILES = new Set(["CLAUDE.md", "AGENTS.md"]);

/**
 * The CLAUDE.md and AGENTS.md files at or under `target`, which is a file or a
 * folder. With `ork`, `target` is an Ork folder and the `runs/` folder directly
 * under it (run state) is skipped; a `runs/` folder deeper down is searched.
 * Links are not followed.
 */
export const knowledgeFilesIn = (target: string, ork = false): string[] => {
  let entries;
  try {
    entries = readdirSync(target, { withFileTypes: true });
  } catch {
    return KNOWLEDGE_FILES.has(path.basename(target)) && existsSync(target)
      ? [target]
      : [];
  }
  return entries.flatMap(entry => {
    const file = path.join(target, entry.name);
    if (entry.isDirectory()) {
      return ork && entry.name === "runs" ? [] : knowledgeFilesIn(file);
    }
    return KNOWLEDGE_FILES.has(entry.name) ? [file] : [];
  });
};

/** A warning for each CLAUDE.md or AGENTS.md under the project's `.ork/`. */
export const knowledgeChecks = (projectRoot: string): CheckResult[] => {
  const ork = path.join(projectRoot, path.dirname(ORK_LAYOUT.agents));
  const found = knowledgeFilesIn(ork, true).map(file =>
    path.relative(projectRoot, file),
  );
  if (found.length === 0) return [];
  return [
    {
      name: "agent instructions under .ork/",
      status: "warn",
      detail: found.join(", "),
      hint: "Agent tools read CLAUDE.md and AGENTS.md as instructions for every contributor. Move the text into .ork/context/ or remove the file.",
    },
  ];
};

/** One line per folder; `created` marks the links this call made. */
export const formatLinks = (
  links: readonly ToolLink[],
  created: readonly string[] = [],
): string[] =>
  links.map(link => {
    const label = created.includes(link.path)
      ? style("green", "linked ")
      : LABEL[link.state]();
    return `${label} ${describe(link)}`;
  });

const checkOf = (tool: string, links: readonly ToolLink[]): CheckResult => {
  const name = `${AGENT_TOOL_LAYOUTS.find(l => l.id === tool)?.name ?? tool} links`;
  const detail = links.map(link => describe(link)).join("; ");
  if (links.every(l => l.state === "linked")) {
    return { name, status: "ok", detail: links.map(l => l.path).join(", ") };
  }
  if (links.some(l => l.state === "broken" || l.state === "missing")) {
    return {
      name,
      status: "warn",
      detail,
      hint: `Run ork link ${tool} to link what is missing; a broken link needs fixing by hand.`,
    };
  }
  return { name, status: "skip", detail };
};

/**
 * One check per tool the project uses, once it has `.ork/`: are its folders
 * linked to `.ork/agents` and `.ork/skills`?
 */
export const linkChecks = (projectRoot: string): CheckResult[] => {
  const ork = path.dirname(ORK_LAYOUT.agents);
  if (!existsSync(path.join(projectRoot, ork))) return [];
  const links = toolLinks(projectRoot, toolsInUse(projectRoot));
  return Object.entries(Object.groupBy(links, link => link.tool)).map(
    ([tool, group = []]) => checkOf(tool, group),
  );
};
