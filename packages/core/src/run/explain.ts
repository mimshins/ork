/**
 * @file What one node's session would load, layer by layer, planned without
 *   writing anything: the agent that fills it, the project's instruction file,
 *   each skill with its layer and whether it's live, shadowed or switched off,
 *   its context files, its practices, and estimated tokens. With `texts`, each
 *   piece's own words too, for a reader that shows them (the UI's context
 *   inspector); `ork context explain` and `ork mcp` leave them out.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Workflow } from "@krapht/ork-schema";

import { estimateTokens } from "../context/lesson-cap.ts";
import type { ContextStack } from "../context/resolve.ts";
import { PLUGIN_NAME, SKILL_FILE } from "../context/session.ts";
import type { CompiledGraph } from "../graph/types.ts";
import {
  practiceInstructions,
  resolvePractices,
} from "../practices/practices.ts";
import { templateOf } from "../store/view.ts";
import { planNodeSession } from "./plan.ts";

export type SkillLine = {
  /** How the session sees it: `ork:<name>` for Ork's, the bare name otherwise. */
  name: string;
  layer: string;
  source: string;
  state: "live" | "off";
  why?: string;
  /** Its SKILL.md, loaded only when the skill is used. */
  tokens: number;
  text?: string;
};

export type Explanation = {
  node: string;
  /** The declared node a spawned worker is planned as (`<template>-<n>`). */
  template?: string;
  type: string;
  workflow: string;
  /** The agent that fills the node: its name, where it is, its role's size. */
  agent?: {
    name: string;
    /** Its file, project-relative or `~/…`, or `workflow` or "ships with Ork". */
    where: string;
    /** Where it comes from: Ork itself, the user, the project or the workflow. */
    source: string;
    tokens: number;
    text?: string;
  };
  instructions: string;
  /** With `texts`: the instruction files Claude Code reads, and their words. */
  instructionFiles?: { name: string; tokens: number; text: string }[];
  skills: SkillLine[];
  files: {
    layer: string;
    name: string;
    tokens: number;
    /** A lessons file cut at its cap: the whole file's tokens. */
    cutFrom?: number;
    text?: string;
  }[];
  practices: { name: string; tokens: number; text?: string }[];
  skippedPractices: string[];
  /** The whole appended system prompt. */
  appendedTokens: number;
  /** With `texts`: that prompt, whole. */
  appended?: string;
};

/** Where a workflow sits, as `checkWorkflowText` and the planner take it. */
export type ExplainPlace = {
  /** The project root, which is also the checkout planned in. */
  root: string;
  /** The project's `.ork` folder. */
  orkDir: string;
  workflowDir: string;
  home?: string;
};

export type ExplainResult =
  | { ok: true; explanation: Explanation }
  | { ok: false; error: string };

const CLAUDE_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];

/** The instruction files Claude Code reads from the checkout. */
const instructionFiles = (stack: ContextStack, checkout: string): string[] => {
  if (stack.instructions === "ignore") return [];
  const present = (file: string) => existsSync(path.join(checkout, file));
  const claude = CLAUDE_FILES.filter(file => present(file));
  if (claude.length > 0) return claude;
  return present("AGENTS.md") ? ["AGENTS.md"] : [];
};

const instructionsOf = (stack: ContextStack, files: string[]): string => {
  if (stack.instructions === "ignore") {
    return "left out (project.instructions: ignore)";
  }
  if (files[0] === "AGENTS.md") return "AGENTS.md, loaded by Claude Code";
  return files.length > 0
    ? "CLAUDE.md, loaded by Claude Code"
    : "none in the project";
};

const whyOff = (skill: ContextStack["skills"][number]): string | undefined => {
  if (skill.shadowedBy !== undefined) {
    return `shadowed by the ${skill.shadowedBy} layer`;
  }
  if (skill.ignored === undefined) return undefined;
  return skill.ignored === "ignore"
    ? "project.skills: ignore"
    : "not in project.skills.allow";
};

const skillLines = (
  stack: ContextStack,
  root: string,
  texts: boolean,
): SkillLine[] =>
  stack.skills.map(skill => {
    const source =
      skill.text === undefined
        ? path.relative(root, skill.dir) || "."
        : "built-in";
    const text =
      skill.text ?? readFileSync(path.join(skill.dir, SKILL_FILE), "utf8");
    const why = whyOff(skill);
    return {
      name:
        skill.layer === "project" ? skill.name : `${PLUGIN_NAME}:${skill.name}`,
      layer: skill.layer,
      source: source.startsWith("..") ? skill.dir : source,
      state: why === undefined ? "live" : "off",
      ...(why === undefined ? {} : { why }),
      tokens: estimateTokens(text),
      ...(texts ? { text } : {}),
    };
  });

/** Adds `text` to a piece when texts are asked for. */
const withText = <T extends object>(
  piece: T,
  text: string,
  texts: boolean,
): T & { text?: string } => (texts ? { ...piece, text } : piece);

/**
 * Plans one node's session in a compiled workflow, as a run in place would, and
 * says what it loads. `texts` adds each piece's words.
 */
export const explainSession = (
  workflow: Workflow,
  graph: CompiledGraph | null,
  nodeId: string,
  place: ExplainPlace,
  options: { texts?: boolean } = {},
): ExplainResult => {
  const texts = options.texts === true;
  const { root } = place;
  // A worker spawned in a run isn't in the file: plan the node it came from.
  const template =
    workflow.nodes[nodeId] === undefined
      ? templateOf(nodeId, new Set(Object.keys(workflow.nodes)))
      : undefined;
  const declared = template ?? nodeId;
  const plan = planNodeSession(workflow, nodeId, {
    ...(template === undefined ? {} : { template }),
    cwd: root,
    inputs: {},
    inPlace: true,
    workflowDir: place.workflowDir,
    projectRoot: root,
    orkDir: place.orkDir,
    ...(place.home === undefined ? {} : { home: place.home }),
  });
  if (!plan.ok) return { ok: false, error: plan.error };
  const { context } = plan;
  const resolved = resolvePractices(workflow, declared);
  const practices = practiceInstructions(resolved, root);
  // The texts come in this order, without the practices switched off or skipped.
  const names = (["caveman", "ponytail"] as const).filter(
    n => resolved[n] !== false && !practices.skipped.includes(n),
  );
  const ref = graph?.agents.get(declared);
  const role =
    ref === undefined ? "" : (workflow.agents?.[ref.name]?.instructions ?? "");
  const files = instructionFiles(context, root);
  const appended = plan.spec.systemAppend;
  return {
    ok: true,
    explanation: {
      node: nodeId,
      ...(template === undefined ? {} : { template }),
      type: workflow.nodes[declared]?.type ?? "",
      workflow: workflow.name,
      ...(ref === undefined
        ? {}
        : {
            agent: withText(
              {
                name: ref.name,
                where: ref.where,
                source: ref.source,
                tokens: estimateTokens(role),
              },
              role,
              texts,
            ),
          }),
      instructions: instructionsOf(context, files),
      ...(texts
        ? {
            instructionFiles: files.map(name => {
              const text = readFileSync(path.join(root, name), "utf8");
              return { name, tokens: estimateTokens(text), text };
            }),
          }
        : {}),
      skills: skillLines(context, root, texts),
      files: context.files.map(f =>
        withText(
          {
            layer: f.layer,
            name: f.name,
            tokens: estimateTokens(f.text),
            ...(f.cutFrom === undefined ? {} : { cutFrom: f.cutFrom }),
          },
          f.text,
          texts,
        ),
      ),
      practices: practices.text.map((text, index) =>
        withText(
          { name: names[index] ?? "practice", tokens: estimateTokens(text) },
          text,
          texts,
        ),
      ),
      skippedPractices: practices.skipped,
      appendedTokens: estimateTokens(appended),
      ...(texts ? { appended } : {}),
    },
  };
};
