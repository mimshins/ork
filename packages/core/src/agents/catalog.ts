/**
 * @file The agent catalog: every agent a project can use, read live from disk.
 *   The user's `~/.ork/agents/`, then the project's tool folders
 *   (`.claude/agents`, `.opencode/agents`, `.ai/agents`, …) and `.ork/agents/`,
 *   the more local winning each name; a workflow's inline `agents:` win over
 *   all of them (apply.ts). Links are followed and a file reached through
 *   several folders counts once, under its real path. Reads, never writes.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { AGENT_TOOL_LAYOUTS, ORK_LAYOUT } from "@krapht/ork-integrations";
import {
  type Agent,
  AGENT_FILE_SUFFIX,
  AGENT_SIDECAR_SUFFIX,
  type Diagnostic,
  parseAgentFile,
} from "@krapht/ork-schema";

import { warning } from "../graph/diagnostics.ts";

/** Where a file agent was found: lowest to highest precedence. */
export const AGENT_SOURCES = ["user", "project"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number] | "workflow";

export type CatalogAgent = {
  name: string;
  agent: Agent;
  source: AgentSource;
  /** The markdown file: project-relative, `~/.ork/…`, or `workflow`. */
  where: string;
  /** The folders it was reached through, when they are links (`.claude/agents`). */
  via: string[];
  /** The agent's folder, which its skill and context paths start from. */
  dir?: string;
  /** 12 hex of the markdown and sidecar (or the inline definition). */
  hash: string;
  /** Set when an agent of the same name from a more local place wins. */
  shadowedBy?: string;
};

export type AgentCatalog = {
  /** Every agent found, lowest precedence first; the shadowed ones marked. */
  agents: CatalogAgent[];
  diagnostics: Diagnostic[];
};

export type CatalogOptions = {
  /** The project's root; without it, only the user's agents. */
  projectRoot?: string;
  /** `~` for the user's `~/.ork/agents`; tests pass a folder. */
  home?: string;
};

export const hashOf = (...parts: readonly string[]): string =>
  createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 12);

const isDir = (target: string): boolean => {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
};

type Folder = { dir: string; label: string; source: "user" | "project" };

/** The folders to read, lowest precedence first. */
const foldersOf = (options: CatalogOptions): Folder[] => {
  const home = options.home ?? homedir();
  const folders: Folder[] = [
    {
      dir: path.join(home, ".ork", "agents"),
      label: "~/.ork/agents",
      source: "user",
    },
  ];
  const root = options.projectRoot;
  if (root !== undefined) {
    const tools = AGENT_TOOL_LAYOUTS.flatMap(layout =>
      layout.agents === undefined ? [] : [layout.agents],
    ).toReversed();
    for (const relative of [...tools, ORK_LAYOUT.agents]) {
      folders.push({
        dir: path.join(root, relative),
        label: relative,
        source: "project",
      });
    }
  }
  return folders;
};

/** Reads one folder's agents; invalid files become warnings. */
const readFolder = (
  folder: Folder,
  root: string | undefined,
  diagnostics: Diagnostic[],
): { agent: CatalogAgent; real: string }[] => {
  if (!isDir(folder.dir)) return [];
  const found: { agent: CatalogAgent; real: string }[] = [];
  for (const entry of readdirSync(folder.dir).toSorted()) {
    if (!entry.endsWith(AGENT_FILE_SUFFIX)) continue;
    const file = path.join(folder.dir, entry);
    const base = entry.slice(0, -AGENT_FILE_SUFFIX.length);
    const sidecarFile = path.join(folder.dir, `${base}${AGENT_SIDECAR_SUFFIX}`);
    const markdown = readFileSync(file, "utf8");
    const sidecar = existsSync(sidecarFile)
      ? readFileSync(sidecarFile, "utf8")
      : undefined;
    const label = `${folder.label}/${entry}`;
    const parsed = parseAgentFile(markdown, sidecar, base);
    if (!parsed.ok) {
      diagnostics.push(
        warning("agent.invalid", `${label} is skipped: ${parsed.message}`, []),
      );
      continue;
    }
    const real = realpathSync(file);
    const relative =
      root === undefined ? undefined : path.relative(realpathSync(root), real);
    const where =
      relative !== undefined &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
        ? relative
        : label;
    found.push({
      agent: {
        name: parsed.name,
        agent: parsed.agent,
        source: folder.source,
        where,
        via: where === label ? [] : [folder.label],
        dir: path.dirname(real),
        hash: hashOf(markdown, sidecar ?? ""),
      },
      real,
    });
  }
  return found;
};

/** Every agent the user and the project offer, read now. */
export const loadAgents = (options: CatalogOptions = {}): AgentCatalog => {
  const diagnostics: Diagnostic[] = [];
  // Keyed by real path, in precedence order: a file reached again through a
  // more local folder moves up to it.
  const byReal = new Map<string, CatalogAgent>();
  for (const folder of foldersOf(options)) {
    for (const { agent, real } of readFolder(
      folder,
      options.projectRoot,
      diagnostics,
    )) {
      const seen = byReal.get(real);
      byReal.delete(real);
      byReal.set(
        real,
        seen === undefined
          ? agent
          : { ...seen, via: [...seen.via, ...agent.via] },
      );
    }
  }
  const agents = [...byReal.values()];
  // A later (more local) agent of the same name shadows an earlier one.
  for (const [index, agent] of agents.entries()) {
    const winner = agents.slice(index + 1).findLast(a => a.name === agent.name);
    if (winner !== undefined) agent.shadowedBy = winner.where;
  }
  return { agents, diagnostics };
};

/** The agent a name resolves to in the catalog: the unshadowed one. */
export const catalogAgent = (
  catalog: AgentCatalog,
  name: string,
): CatalogAgent | undefined =>
  catalog.agents.find(a => a.name === name && a.shadowedBy === undefined);
