/**
 * @file What `ork agents` prints and does: the catalog as a table, one agent in
 *   full, and adding an agent to Ork's folders, new or copied from one the
 *   project or the user already has.
 */

import {
  type AgentCatalog,
  type AgentFolderOptions,
  type AgentWrite,
  type CatalogAgent,
  createAgent,
} from "@krapht/ork-core";
import { type Agent, type AgentSettings, settingsOf } from "@krapht/ork-schema";
import { stringify } from "yaml";

import { style } from "../output.ts";

const whereOf = (agent: CatalogAgent): string =>
  agent.via.length === 0
    ? agent.where
    : `${agent.where} (via ${agent.via.join(", ")})`;

/** One line per agent: name, source, file, and what shadows it. */
export const formatAgents = (catalog: AgentCatalog): string[] => {
  if (catalog.agents.length === 0) {
    return [
      "No agents yet. Add one with ork agents add <name>, or put agents in .claude/agents.",
    ];
  }
  const width = Math.max(...catalog.agents.map(a => a.name.length));
  return catalog.agents.map(agent => {
    const head = `${agent.name.padEnd(width)}  ${agent.source.padEnd(7)}  ${whereOf(agent)}`;
    return agent.shadowedBy === undefined
      ? `${head}${agent.agent.description === undefined ? "" : style("dim", `  ${agent.agent.description}`)}`
      : style("dim", `${head}  shadowed by ${agent.shadowedBy}`);
  });
};

const settingsLines = (settings: AgentSettings): string[] =>
  Object.keys(settings).length === 0
    ? []
    : [
        "",
        "Settings:",
        ...stringify(settings, { lineWidth: 0 })
          .trimEnd()
          .split("\n")
          .map(l => `  ${l}`),
      ];

/** An agent in full: where it is, its settings and its role. */
export const formatAgent = (agent: CatalogAgent): string[] => [
  style("bold", agent.name),
  ...(agent.agent.description === undefined ? [] : [agent.agent.description]),
  "",
  `Source: ${agent.source} · ${whereOf(agent)} · ${agent.hash}`,
  ...(agent.shadowedBy === undefined
    ? []
    : [`Shadowed by ${agent.shadowedBy}`]),
  ...settingsLines(settingsOf(agent.agent)),
  ...(agent.agent.instructions === undefined
    ? []
    : [
        "",
        "Role:",
        ...agent.agent.instructions.split("\n").map(l => `  ${l}`),
      ]),
];

export type AddAgentOptions = AgentFolderOptions & {
  name: string;
  description?: string;
  model?: string;
  /** An agent in the catalog to copy. */
  from?: CatalogAgent;
};

/** Adds an agent to Ork's folder: a copy of `from`, or a new one. */
export const addAgent = (options: AddAgentOptions): AgentWrite => {
  const agent: Agent =
    options.from === undefined
      ? {
          instructions: `You are ${options.name}.${options.description === undefined ? "" : ` ${options.description}`}`,
        }
      : { ...options.from.agent };
  if (options.description !== undefined)
    agent.description = options.description;
  if (options.model !== undefined) agent.model = options.model;
  return createAgent(options.name, agent, options);
};
