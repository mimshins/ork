/**
 * @file The agent registry's writes: create, update and delete an agent in
 *   Ork's own folders only, the user's `~/.ork/agents/` or the project's
 *   `.ork/agents/`. An agent is its `<name>.md` and, when it has Ork settings,
 *   its `<name>.agent.yaml`. A project's tool folders (`.claude/agents`, …) are
 *   never written; link them to `.ork/agents` to manage them here.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { ORK_LAYOUT } from "@krapht/ork-integrations";
import {
  type Agent,
  AGENT_FILE_SUFFIX,
  AGENT_SIDECAR_SUFFIX,
  AgentNameSchema,
  AgentSchema,
  serializeAgent,
} from "@krapht/ork-schema";

/** Which of Ork's folders: the user's, or the project's. */
export type AgentScope = "user" | "project";

export type AgentFolderOptions = {
  scope: AgentScope;
  /** Needed for the project scope. */
  projectRoot?: string;
  /** `~`; tests pass a folder. */
  home?: string;
};

export type AgentWrite =
  | { ok: true; files: string[] }
  | { ok: false; error: string };

/** Ork's agent folder for a scope. */
export const agentFolder = (options: AgentFolderOptions): string | null => {
  if (options.scope === "user") {
    return path.join(options.home ?? homedir(), ".ork", "agents");
  }
  return options.projectRoot === undefined
    ? null
    : path.join(options.projectRoot, ORK_LAYOUT.agents);
};

const filesOf = (dir: string, name: string) => ({
  markdown: path.join(dir, `${name}${AGENT_FILE_SUFFIX}`),
  sidecar: path.join(dir, `${name}${AGENT_SIDECAR_SUFFIX}`),
});

const write = (
  name: string,
  agent: Agent,
  options: AgentFolderOptions,
  mode: "create" | "update",
): AgentWrite => {
  if (!AgentNameSchema.safeParse(name).success) {
    return {
      ok: false,
      error: `"${name}" is not an agent name (lowercase letters, digits, '-' and '_')`,
    };
  }
  const parsed = AgentSchema.safeParse(agent);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }
  const dir = agentFolder(options);
  if (dir === null) return { ok: false, error: "no project to write to" };
  const files = filesOf(dir, name);
  const exists = existsSync(files.markdown);
  if (mode === "create" && exists) {
    return { ok: false, error: `${name} already exists in ${dir}` };
  }
  if (mode === "update" && !exists) {
    return { ok: false, error: `${name} is not in ${dir}` };
  }
  const { markdown, sidecar } = serializeAgent(name, parsed.data);
  mkdirSync(dir, { recursive: true });
  writeFileSync(files.markdown, markdown);
  const written = [files.markdown];
  if (sidecar === null) {
    rmSync(files.sidecar, { force: true });
  } else {
    writeFileSync(files.sidecar, sidecar);
    written.push(files.sidecar);
  }
  return { ok: true, files: written };
};

/** Creates an agent in Ork's folder for the scope; never overwrites. */
export const createAgent = (
  name: string,
  agent: Agent,
  options: AgentFolderOptions,
): AgentWrite => write(name, agent, options, "create");

/** Replaces an agent that is already in Ork's folder for the scope. */
export const updateAgent = (
  name: string,
  agent: Agent,
  options: AgentFolderOptions,
): AgentWrite => write(name, agent, options, "update");

/** Deletes an agent from Ork's folder for the scope. */
export const deleteAgent = (
  name: string,
  options: AgentFolderOptions,
): AgentWrite => {
  const dir = agentFolder(options);
  if (dir === null) return { ok: false, error: "no project to delete from" };
  const files = filesOf(dir, name);
  if (!existsSync(files.markdown)) {
    return { ok: false, error: `${name} is not in ${dir}` };
  }
  const removed = [files.markdown];
  rmSync(files.markdown);
  if (existsSync(files.sidecar)) {
    rmSync(files.sidecar);
    removed.push(files.sidecar);
  }
  return { ok: true, files: removed };
};
