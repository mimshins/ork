/**
 * @file Fills each agent node from its agent: for every Claude node with
 *   `agent:`, the agent comes from the workflow's inline `agents:` or else the
 *   catalog, and each setting the node leaves unset takes the agent's. The
 *   result is the effective workflow the run uses, with every agent it uses
 *   inline (so the role travels with it), and which agent filled which node.
 */

import path from "node:path";

import {
  type Agent,
  AGENT_SETTING_KEYS,
  type Diagnostic,
  isClaudeNode,
  type Node,
  type Workflow,
} from "@krapht/ork-schema";

import { parseSkillRef } from "../context/skills.ts";
import { error } from "../graph/diagnostics.ts";
import {
  type AgentCatalog,
  type AgentSource,
  catalogAgent,
  hashOf,
} from "./catalog.ts";

/** Which agent filled a node, as recorded in its events. */
export type AgentRef = {
  name: string;
  source: AgentSource;
  where: string;
  hash: string;
};

export type ApplyOptions = {
  catalog?: AgentCatalog;
  /** The workflow file's folder: an agent file's paths are rebased onto it. */
  workflowDir?: string;
};

export type ApplyResult = {
  workflow: Workflow;
  /** Node id → the agent that filled it. */
  agents: Map<string, AgentRef>;
  diagnostics: Diagnostic[];
};

/** A path reference from the agent's folder, rewritten from the workflow's. */
const rebase = (ref: string, from: string, to: string): string => {
  if (parseSkillRef(ref).kind !== "path") return ref;
  const relative = path.relative(to, path.resolve(from, ref));
  return relative.startsWith("..") ? relative : `./${relative}`;
};

/** A file agent with its skill and context paths made workflow-relative. */
const rebased = (agent: Agent, from: string, to: string): Agent => {
  const out: Agent = { ...agent };
  if (agent.skills !== undefined) {
    out.skills = agent.skills.map(ref => rebase(ref, from, to));
  }
  if (agent.context !== undefined) {
    out.context = agent.context.map(ref => rebase(ref, from, to));
  }
  return out;
};

/** The node with each setting it leaves unset taken from `agent`. */
const filled = (node: Node, agent: Agent): Node => {
  const out: Record<string, unknown> = { ...node };
  for (const key of AGENT_SETTING_KEYS) {
    if (out[key] === undefined && agent[key] !== undefined) {
      out[key] = agent[key];
    }
  }
  // Sound: only settings both shapes share were copied onto a Claude node.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return out as Node;
};

/** Applies agents to a workflow's agent nodes. */
export const applyAgents = (
  workflow: Workflow,
  options: ApplyOptions = {},
): ApplyResult => {
  const diagnostics: Diagnostic[] = [];
  const refs = new Map<string, AgentRef>();
  const inline = workflow.agents ?? {};
  const used: Record<string, Agent> = { ...inline };
  const nodes: Workflow["nodes"] = {};

  for (const [id, node] of Object.entries(workflow.nodes)) {
    nodes[id] = node;
    if (!isClaudeNode(node) || node.agent === undefined) continue;
    const name = node.agent;
    const own = inline[name];
    if (own !== undefined) {
      nodes[id] = filled(node, own);
      refs.set(id, {
        name,
        source: "workflow",
        where: "workflow",
        hash: hashOf(JSON.stringify(own)),
      });
      continue;
    }
    const found =
      options.catalog === undefined
        ? undefined
        : catalogAgent(options.catalog, name);
    if (found === undefined) {
      const known = [
        ...Object.keys(inline),
        ...(options.catalog?.agents ?? [])
          .filter(a => a.shadowedBy === undefined)
          .map(a => a.name),
      ].toSorted();
      diagnostics.push(
        error(
          "agent.unknown",
          `"${id}" names agent "${name}", which is not defined${known.length === 0 ? "" : `; known: ${known.join(", ")}`}`,
          ["nodes", id, "agent"],
        ),
      );
      continue;
    }
    const agent =
      found.dir === undefined || options.workflowDir === undefined
        ? found.agent
        : rebased(found.agent, found.dir, options.workflowDir);
    used[name] = agent;
    nodes[id] = filled(node, agent);
    refs.set(id, {
      name,
      source: found.source,
      where: found.where,
      hash: found.hash,
    });
  }

  const effective: Workflow = { ...workflow, nodes };
  if (Object.keys(used).length > 0) effective.agents = used;
  return { workflow: effective, agents: refs, diagnostics };
};
