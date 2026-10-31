/**
 * @file `ork context explain <wf> <node>`: what one node's session would load,
 *   layer by layer. Its project instructions, every skill with the layer it
 *   came from and whether it is live, shadowed or switched off, its context
 *   files, its practices, and estimated tokens. Plans the session without
 *   writing anything.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  type ContextStack,
  PLUGIN_NAME,
  planNodeSession,
  practiceInstructions,
  projectRootOf,
  resolvePractices,
  SKILL_FILE,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { style, write } from "../output.ts";
import { resolveWorkflowArg } from "../workflows.ts";
import { formatReport, loadWorkflow } from "./validate.ts";

/** A rough count, for comparing sizes: about four characters a token. */
export const tokens = (text: string): number => Math.ceil(text.length / 4);

export type SkillLine = {
  /** How the session sees it: `ork:<name>` for Ork's, the bare name otherwise. */
  name: string;
  layer: string;
  source: string;
  state: "live" | "off";
  why?: string;
  /** Its SKILL.md, loaded only when the skill is used. */
  tokens: number;
};

export type Explanation = {
  node: string;
  type: string;
  workflow: string;
  /** The agent that fills the node: its name, where it is, its role's size. */
  agent?: { name: string; where: string; tokens: number };
  instructions: string;
  skills: SkillLine[];
  files: { layer: string; name: string; tokens: number }[];
  practices: { name: string; tokens: number }[];
  skippedPractices: string[];
  /** The whole appended system prompt. */
  appendedTokens: number;
};

/** Which project instruction file Claude Code reads from the checkout. */
const instructionsOf = (stack: ContextStack, checkout: string): string => {
  if (stack.instructions === "ignore") {
    return "left out (project.instructions: ignore)";
  }
  const has = (file: string) => existsSync(path.join(checkout, file));
  if (
    ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"].some(file =>
      has(file),
    )
  ) {
    return "CLAUDE.md, loaded by Claude Code";
  }
  if (has("AGENTS.md")) return "AGENTS.md, loaded by Claude Code";
  return "none in the project";
};

const skillLines = (stack: ContextStack, root: string): SkillLine[] =>
  stack.skills.map(skill => {
    const source = path.relative(root, skill.dir) || ".";
    const ours = skill.layer !== "project";
    const line: SkillLine = {
      name: ours ? `${PLUGIN_NAME}:${skill.name}` : skill.name,
      layer: skill.layer,
      source: source.startsWith("..") ? skill.dir : source,
      state:
        skill.shadowedBy === undefined && skill.ignored === undefined
          ? "live"
          : "off",
      tokens: tokens(readFileSync(path.join(skill.dir, SKILL_FILE), "utf8")),
    };
    if (skill.shadowedBy !== undefined) {
      line.why = `shadowed by the ${skill.shadowedBy} layer`;
    } else if (skill.ignored !== undefined) {
      line.why =
        skill.ignored === "ignore"
          ? "project.skills: ignore"
          : "not in project.skills.allow";
    }
    return line;
  });

export type ExplainResult =
  | { ok: true; explanation: Explanation }
  | { ok: false; lines: string[] };

export const explainNode = (
  file: string,
  nodeId: string,
  cwd: string,
  home?: string,
): ExplainResult => {
  const { report, workflow, graph } = loadWorkflow(file, cwd, home);
  if (workflow === null) return { ok: false, lines: formatReport(report) };
  const workflowDir = path.dirname(path.resolve(cwd, file));
  const root = projectRootOf(workflowDir);
  const plan = planNodeSession(workflow, nodeId, {
    cwd: root,
    inputs: {},
    inPlace: true,
    workflowDir,
    projectRoot: root,
    ...(home === undefined ? {} : { home }),
  });
  if (!plan.ok) return { ok: false, lines: [plan.error] };
  const { context } = plan;
  const practices = practiceInstructions(
    resolvePractices(workflow, nodeId),
    root,
  );
  const names = ["caveman", "ponytail"].filter(
    n => !practices.skipped.includes(n),
  );
  const ref = graph?.agents.get(nodeId);
  const role =
    ref === undefined ? undefined : workflow.agents?.[ref.name]?.instructions;
  return {
    ok: true,
    explanation: {
      node: nodeId,
      type: workflow.nodes[nodeId]?.type ?? "",
      workflow: workflow.name,
      ...(ref === undefined
        ? {}
        : {
            agent: {
              name: ref.name,
              where: ref.where,
              tokens: tokens(role ?? ""),
            },
          }),
      instructions: instructionsOf(context, root),
      skills: skillLines(context, root),
      files: context.files.map(f => ({
        layer: f.layer,
        name: f.name,
        tokens: tokens(f.text),
      })),
      practices: practices.text.map((text, index) => ({
        name: names[index] ?? "practice",
        tokens: tokens(text),
      })),
      skippedPractices: practices.skipped,
      appendedTokens: tokens(plan.spec.systemAppend),
    },
  };
};

const approx = (count: number): string =>
  style("dim", `≈${count.toLocaleString("en")} tokens`);

export const formatExplanation = (e: Explanation): string[] => {
  const width = Math.max(8, ...e.skills.map(s => s.name.length));
  const sourceWidth = Math.max(0, ...e.skills.map(s => s.source.length));
  const lines = [
    `${style("bold", e.node)} ${style("dim", `(${e.type}) in ${e.workflow}`)}`,
    "",
    ...(e.agent === undefined
      ? []
      : [
          `${style("bold", "Agent")}  ${e.agent.name} ${style("dim", `(${e.agent.where})`)}  ${approx(e.agent.tokens)}`,
        ]),
    `${style("bold", "Instructions")}  ${e.instructions}`,
    "",
    style("bold", "Skills"),
  ];
  if (e.skills.length === 0) lines.push(style("dim", "  none"));
  for (const s of e.skills) {
    const mark = s.state === "live" ? style("green", "✓") : style("dim", "−");
    const state =
      s.why === undefined
        ? approx(s.tokens).replace("tokens", "tokens when used")
        : style("yellow", `off: ${s.why}`);
    lines.push(
      `  ${mark} ${s.name.padEnd(width)}  ${s.layer.padEnd(8)}  ${style("dim", s.source.padEnd(sourceWidth))}  ${state}`,
    );
  }
  lines.push("", style("bold", "Context files"));
  if (e.files.length === 0) lines.push(style("dim", "  none"));
  for (const f of e.files) {
    lines.push(`  ${f.layer.padEnd(8)}  ${f.name}  ${approx(f.tokens)}`);
  }
  lines.push("", style("bold", "Practices"));
  for (const p of e.practices)
    lines.push(`  ${p.name.padEnd(8)}  ${approx(p.tokens)}`);
  for (const name of e.skippedPractices) {
    lines.push(
      `  ${name.padEnd(8)}  ${style("dim", "the project's own skill wins")}`,
    );
  }
  if (e.practices.length === 0 && e.skippedPractices.length === 0) {
    lines.push(style("dim", "  off"));
  }
  lines.push(
    "",
    `Appended to Claude Code's system prompt: ${approx(e.appendedTokens)}`,
  );
  return lines;
};

const explain = defineCommand({
  meta: {
    name: "explain",
    description: "Show what one node's session loads, layer by layer",
  },
  args: {
    workflow: {
      type: "positional",
      description: "A workflow file, or the name of one in .ork/workflows/",
      required: true,
    },
    node: { type: "positional", description: "Node id", required: true },
    json: { type: "boolean", description: "Print JSON", default: false },
  },
  run: ({ args }) => {
    const cwd = process.cwd();
    const result = explainNode(
      resolveWorkflowArg(args.workflow, cwd),
      args.node,
      cwd,
    );
    if (!result.ok) {
      for (const line of result.lines) process.stderr.write(`${line}\n`);
      process.exitCode = 1;
      return;
    }
    if (args.json) write(JSON.stringify(result.explanation, undefined, 2));
    else for (const line of formatExplanation(result.explanation)) write(line);
  },
});

export const context = defineCommand({
  meta: {
    name: "context",
    description: "Inspect the context Ork compiles for each node",
  },
  subCommands: { explain },
});
