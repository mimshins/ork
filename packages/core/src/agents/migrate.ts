/**
 * @file Bringing a project's agents and skills under `.ork/`, the origin
 *   (ADR-031, ADR-036): `ork migrate --agents`. A tool folder that is a real
 *   folder, or a folder in the repository a tool folder links to (se-backend's
 *   `.ai/agents`), has its files moved into `.ork/agents` or `.ork/skills` and
 *   becomes a link to it, and every link to it is pointed at `.ork/` instead.
 *   Links that leave the repository, and broken ones, are kept and reported.
 */

import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { ORK_LAYOUT } from "@krapht/ork-integrations";

import { inside } from "../context/files.ts";
import { type MovePlan, planMoveInto } from "../project/move.ts";
import { LINK_KINDS, type ToolLink, toolLinks } from "./links.ts";

export type AgentMigration = MovePlan & {
  /** Tool folders left as they are: broken, or linking outside the project. */
  kept: ToolLink[];
};

const isLink = (target: string): boolean => {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
};

/** The real folder a tool folder's files are in, if it is in the project. */
const folderOf = (root: string, link: ToolLink): string | undefined => {
  if (link.state !== "folder" && link.state !== "elsewhere") return undefined;
  const real = realpathSync(path.join(root, link.path));
  const isFolder = lstatSync(real).isDirectory();
  return isFolder && inside(root, real) ? real : undefined;
};

/**
 * Adds the steps that bring the agents and skills of the project at `root`
 * under `.ork/` to `plan` (whose earlier steps count as done).
 */
export const planAgentMigration = (
  projectRoot: string,
  before?: MovePlan,
): AgentMigration => {
  const plan = before ?? { steps: [], clashes: [] };
  const root = realpathSync(projectRoot);
  const kept: ToolLink[] = [];
  for (const kind of LINK_KINDS) {
    const origin = path.join(root, ORK_LAYOUT[kind]);
    if (isLink(origin)) {
      plan.clashes.push(`${ORK_LAYOUT[kind]} (a link: make it a folder first)`);
      continue;
    }
    const links = toolLinks(root).filter(l => l.kind === kind);
    const sources = new Set<string>();
    for (const link of links) {
      const folder = folderOf(root, link);
      if (folder !== undefined) sources.add(folder);
      else if (link.state !== "linked" && link.state !== "missing") {
        kept.push(link);
      }
    }
    for (const source of sources) {
      for (const name of readdirSync(source).toSorted()) {
        planMoveInto(path.join(source, name), path.join(origin, name), plan);
      }
      plan.steps.push({ kind: "link", at: source, to: origin });
    }
    for (const link of links) {
      const at = path.join(root, link.path);
      if (
        link.state === "elsewhere" &&
        sources.has(folderOf(root, link) ?? "")
      ) {
        plan.steps.push({ kind: "link", at, to: origin });
      }
    }
  }
  return { ...plan, kept };
};
