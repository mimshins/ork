/**
 * @file `ork migrate --from-agents` (ADR-036): drafts a workflow from a
 *   project's agents, for the user to edit. The named agents work one after
 *   another, each in its own worktree; an optional reviewer reads the last
 *   one's change after a human gate and sends it back while it asks for
 *   changes; then the change is staged, shown at a second gate, and committed
 *   on a branch the run is given. The draft sets `git.commit: never`, so Ork
 *   itself commits nothing, and nothing is pushed.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  type AgentCatalog,
  loadAgents,
  placeFiles,
  type ProjectPlace,
} from "@krapht/ork-core";
import {
  serializeWorkflow,
  type Workflow,
  WorkflowSchema,
} from "@krapht/ork-schema";

import { style, write, writeErr } from "../output.ts";
import { WORKFLOW_SUFFIX } from "../workflows.ts";
import { projectAt } from "./place.ts";

export type DraftOptions = {
  /** The agents that change the project, in order. */
  agents: readonly string[];
  /** The agent that reviews the last one's change, if any. */
  reviewer?: string;
  /** The workflow's name (and file name). */
  name: string;
};

/** The ids the draft gives its own nodes. */
const OWN_NODES = ["ready", "stage", "approve", "branch", "commit"] as const;

const MAX_REVIEW_ROUNDS = 3;

/** The draft, as a workflow. */
export const draftWorkflow = (options: DraftOptions): Workflow => {
  const { agents, reviewer } = options;
  const last = agents.at(-1) ?? "";
  const here = `{{nodes.${last}.output.worktree}}`;
  const nodes: Workflow["nodes"] = {};
  for (const [index, agent] of agents.entries()) {
    const before = agents[index - 1];
    nodes[agent] = {
      type: "claude.worker",
      agent,
      isolation: "worktree",
      prompt:
        before === undefined
          ? "{{inputs.task}}"
          : `{{inputs.task}}\n\n${before} reported: {{nodes.${before}.output.summary}}`,
    };
  }
  const edges: Workflow["edges"] = agents
    .slice(1)
    .map((agent, index) => `${agents[index] ?? ""} -> ${agent}`);
  if (reviewer === undefined) edges.push(`${last} -> stage`);
  else {
    nodes["ready"] = {
      type: "human.gate",
      question: `${last} is done: {{nodes.${last}.output.summary}}\nSend the change to ${reviewer}?`,
      options: ["review", "stop"],
      recommended: "review",
    };
    nodes[reviewer] = {
      type: "claude.worker",
      agent: reviewer,
      isolation: "readonly",
      session: "resume",
      prompt: `Review ${last}'s change for: {{inputs.task}}\nReport pass, or changes_requested with what to fix.`,
    };
    edges.push(
      `${last} -> ready`,
      { from: "ready", to: reviewer, when: "choice == 'review'" },
      {
        from: reviewer,
        to: last,
        when: "status == 'changes_requested'",
        maxRounds: MAX_REVIEW_ROUNDS,
      },
      { from: reviewer, to: "stage", when: "status == 'pass'" },
    );
  }
  nodes["stage"] = { type: "tool.git", command: "add -A", cwd: here };
  nodes["approve"] = {
    type: "human.gate",
    question:
      "Commit this on {{inputs.branch}}?\n{{nodes.stage.output.staged}}",
    options: ["commit", "stop"],
    recommended: "commit",
  };
  nodes["branch"] = {
    type: "tool.git",
    command: "switch -c {{inputs.branch}}",
    allow: ["switch"],
    cwd: here,
  };
  nodes["commit"] = {
    type: "tool.git",
    command: "commit -m {{inputs.message}}",
    cwd: here,
  };
  edges.push(
    "stage -> approve",
    { from: "approve", to: "branch", when: "choice == 'commit'" },
    "branch -> commit",
  );
  const team = [...agents, ...(reviewer === undefined ? [] : [reviewer])];
  return {
    schemaVersion: 1,
    name: options.name,
    description: `Drafted by ork migrate from the agents ${team.join(", ")}. Edit it to fit.`,
    inputs: {
      task: { type: "string", required: true, description: "What to do." },
      branch: {
        type: "string",
        required: true,
        description: "The branch the change is committed on.",
      },
      message: {
        type: "string",
        required: true,
        description: "The commit message.",
      },
    },
    rules: { git: { commit: "never" } },
    nodes,
    edges,
  };
};

export type Drafted = { ok: true; file: string } | { ok: false; error: string };

/** Why the agents cannot be drafted into a workflow, if they cannot. */
const problemWith = (
  options: DraftOptions,
  known: readonly string[],
): string | undefined => {
  const team = [
    ...options.agents,
    ...(options.reviewer === undefined ? [] : [options.reviewer]),
  ];
  if (options.agents.length === 0) return "Name at least one agent.";
  const unknown = team.filter(name => !known.includes(name));
  if (unknown.length > 0) {
    return `No agent ${unknown.join(", ")}; known: ${known.join(", ") || "none"} (ork agents list).`;
  }
  if (new Set(team).size < team.length) return "Each agent can appear once.";
  const taken = team.filter(name => OWN_NODES.some(own => own === name));
  if (taken.length > 0) {
    return `The draft names its own nodes ${OWN_NODES.join(", ")}; rename agent ${taken.join(", ")} first.`;
  }
  return undefined;
};

/**
 * Writes the draft to the project's `workflows/<name>.ork.yaml`, never over an
 * existing file.
 */
export const writeDraft = (
  place: ProjectPlace,
  catalog: Pick<AgentCatalog, "agents">,
  options: DraftOptions,
): Drafted => {
  const problem = problemWith(
    options,
    catalog.agents.map(agent => agent.name),
  );
  if (problem !== undefined) return { ok: false, error: problem };
  const workflow = WorkflowSchema.safeParse(draftWorkflow(options));
  if (!workflow.success) {
    const issues = workflow.error.issues.map(issue => issue.message);
    return { ok: false, error: `The draft is not valid: ${issues.join("; ")}` };
  }
  const folder = placeFiles(place).workflows;
  const file = path.join(folder, `${options.name}${WORKFLOW_SUFFIX}`);
  if (existsSync(file)) {
    return { ok: false, error: `${file} exists; pass another --name.` };
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, serializeWorkflow(workflow.data));
  return { ok: true, file };
};

/**
 * `ork migrate --from-agents` in `cwd`: drafts the workflow into the project's
 * folder and prints what `check` (the validator) says about it.
 */
export const draftHere = (
  cwd: string,
  args: { from: string; reviewer?: string | undefined; name: string },
  check: (file: string) => string[],
): void => {
  const place = projectAt(cwd);
  const drafted = writeDraft(
    place,
    loadAgents({ projectRoot: place.root, orkDir: place.dir }),
    {
      agents: args.from
        .split(",")
        .map(a => a.trim())
        .filter(Boolean),
      name: args.name,
      ...(args.reviewer === undefined ? {} : { reviewer: args.reviewer }),
    },
  );
  if (!drafted.ok) {
    writeErr(drafted.error);
    process.exitCode = 1;
    return;
  }
  write(`${style("green", "drafted")} ${drafted.file}`);
  for (const line of check(drafted.file)) write(line);
  write(
    `Edit it to fit, then ${style("bold", `ork run ${args.name} --input task=… --input branch=… --input message=…`)}.`,
  );
};
