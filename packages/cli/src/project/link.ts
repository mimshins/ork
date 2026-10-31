/**
 * @file What `ork link` and `ork doctor` say about a project's tool folders:
 *   one line per folder (linked, created, kept as a real folder, pointing
 *   elsewhere, broken), and one doctor check per tool the project uses, only
 *   once the project has `.ork/`.
 */

import { existsSync } from "node:fs";
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

const LABEL: Record<ToolLink["state"], string> = {
  linked: style("dim", "ok     "),
  missing: style("yellow", "missing"),
  broken: style("red", "broken "),
  elsewhere: style("yellow", "kept   "),
  folder: style("yellow", "kept   "),
};

/** One line per folder; `created` marks the links this call made. */
export const formatLinks = (
  links: readonly ToolLink[],
  created: readonly string[] = [],
): string[] =>
  links.map(link => {
    const label = created.includes(link.path)
      ? style("green", "linked ")
      : LABEL[link.state];
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
