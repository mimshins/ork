/**
 * @file The context compiler's layer resolver (specs/context.md): for one node,
 *   every skill and context file from the user, project, workflow and node
 *   layers, which skill wins each name (the more local layer), which project
 *   skills to switch off, and `ref.skill` / `ref.context` diagnostics. Pure
 *   over the filesystem: it reads, never writes.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  type Diagnostic,
  type DiagnosticPath,
  isClaudeNode,
  type Workflow,
} from "@krapht/ork-schema";

import { error, warning } from "../graph/diagnostics.ts";
import {
  type ContextFile,
  contextFiles,
  inside,
  lessons,
  userContext,
} from "./files.ts";
import {
  BUILTIN_SKILLS,
  parseSkillRef,
  SKILL_FILE,
  SKILL_LAYERS,
  type Skill,
  type SkillLayer,
  skillName,
  skillsIn,
} from "./skills.ts";

export type ContextOptions = {
  workflow: Workflow;
  /** The declared node (a spawned worker's template). */
  nodeId: string;
  /** The workflow file's folder: references resolve from it. */
  workflowDir: string;
  /** References may not leave it. */
  projectRoot: string;
  /** Where the session runs: its `.claude/skills` is the project layer. */
  checkout: string;
  /** `~` for the user layer, `~/.ork/`; tests pass a folder. */
  home?: string;
};

export type ResolvedSkill = Skill & {
  /** Set when a skill of the same name in a higher layer wins. */
  shadowedBy?: SkillLayer;
  /** Set for a project skill the workflow leaves out. */
  ignored?: "ignore" | "not allowed";
};

export type ContextStack = {
  /** Every skill found, lowest layer first; shadowed and ignored ones marked. */
  skills: ResolvedSkill[];
  /** The winners Ork loads itself, as `ork:<name>` (not the project's). */
  plugin: Skill[];
  /** Project skills to switch off in the session. */
  projectOff: string[];
  files: ContextFile[];
  /** `ignore` keeps the project's CLAUDE.md, rules and AGENTS.md out. */
  instructions: "inherit" | "ignore";
  diagnostics: Diagnostic[];
};

/** The skills a list of references names, at one layer. */
const referenced = (
  refs: readonly string[],
  layer: SkillLayer,
  at: DiagnosticPath,
  options: ContextOptions,
  diagnostics: Diagnostic[],
): Skill[] => {
  const skills: Skill[] = [];
  refs.forEach((ref, index) => {
    const where = [...at, index];
    const parsed = parseSkillRef(ref);
    if (parsed.kind === "invalid") {
      diagnostics.push(error("ref.skill", parsed.message, where));
      return;
    }
    if (parsed.kind === "builtin") {
      const dir = BUILTIN_SKILLS[parsed.name];
      if (dir === undefined) {
        diagnostics.push(
          error(
            "ref.skill",
            `Ork has no built-in skill "${parsed.name}"`,
            where,
          ),
        );
      } else {
        skills.push({ name: parsed.name, layer, dir, ref });
      }
      return;
    }
    const dir = path.resolve(options.workflowDir, parsed.path);
    if (!inside(options.projectRoot, dir)) {
      diagnostics.push(
        error("ref.skill", `${ref} is outside the project`, where),
      );
      return;
    }
    if (!existsSync(path.join(dir, SKILL_FILE))) {
      diagnostics.push(
        error("ref.skill", `${ref} has no ${SKILL_FILE}`, where),
      );
      return;
    }
    skills.push({ name: skillName(dir), layer, dir, ref });
  });
  const names = new Set<string>();
  for (const skill of skills) {
    if (names.has(skill.name)) {
      diagnostics.push(
        error("ref.skill", `two ${layer} skills are named "${skill.name}"`, at),
      );
    }
    names.add(skill.name);
  }
  return skills;
};

/** A skill with why it does not load. */
const marked = (
  skill: Skill,
  mark: Pick<ResolvedSkill, "shadowedBy" | "ignored">,
): ResolvedSkill => ({ ...skill, ...mark });

/** Marks what the workflow's `project.skills` leaves out. */
const filterProject = (
  project: Skill[],
  setting: NonNullable<NonNullable<Workflow["layers"]>["project"]>["skills"],
  diagnostics: Diagnostic[],
): ResolvedSkill[] => {
  if (setting === undefined || setting === "inherit") return project;
  if (setting === "ignore") {
    return project.map(s => marked(s, { ignored: "ignore" }));
  }
  setting.allow.forEach((name, index) => {
    if (!project.some(s => s.name === name)) {
      diagnostics.push(
        warning("ref.skill", `the project has no skill "${name}"`, [
          "layers",
          "project",
          "skills",
          "allow",
          index,
        ]),
      );
    }
  });
  return project.map(s =>
    setting.allow.includes(s.name) ? s : marked(s, { ignored: "not allowed" }),
  );
};

/**
 * Resolves one node's layers. Same-named skills: node over workflow over
 * project over user, and only the winner loads; nothing is loaded twice.
 */
export const resolveContext = (options: ContextOptions): ContextStack => {
  const { workflow, nodeId } = options;
  const home = options.home ?? homedir();
  const declared = workflow.nodes[nodeId];
  const node =
    declared !== undefined && isClaudeNode(declared) ? declared : undefined;
  const layers = workflow.layers ?? {};
  const diagnostics: Diagnostic[] = [];

  const found: Record<SkillLayer, ResolvedSkill[]> = {
    user: skillsIn(path.join(home, ".ork", "skills"), "user"),
    project: filterProject(
      skillsIn(path.join(options.checkout, ".claude", "skills"), "project"),
      layers.project?.skills,
      diagnostics,
    ),
    workflow: referenced(
      layers.skills ?? [],
      "workflow",
      ["layers", "skills"],
      options,
      diagnostics,
    ),
    node: referenced(
      node?.skills ?? [],
      "node",
      ["nodes", nodeId, "skills"],
      options,
      diagnostics,
    ),
  };

  // The highest layer that has a name wins it.
  const winner = new Map<string, SkillLayer>();
  for (const layer of SKILL_LAYERS) {
    for (const skill of found[layer]) {
      if (skill.ignored === undefined) winner.set(skill.name, layer);
    }
  }
  const skills = SKILL_LAYERS.flatMap(layer =>
    found[layer].map((skill): ResolvedSkill => {
      const top = winner.get(skill.name);
      return top === undefined || top === layer || skill.ignored !== undefined
        ? skill
        : marked(skill, { shadowedBy: top });
    }),
  );
  const live = (s: ResolvedSkill) =>
    s.shadowedBy === undefined && s.ignored === undefined;

  return {
    skills,
    plugin: skills.filter(s => s.layer !== "project" && live(s)),
    projectOff: skills
      .filter(s => s.layer === "project" && !live(s))
      .map(s => s.name),
    files: [
      ...userContext(home),
      ...contextFiles(
        layers.context ?? [],
        "workflow",
        ["layers", "context"],
        options,
        diagnostics,
      ),
      ...lessons(workflow.name, options.projectRoot),
      ...contextFiles(
        node?.context ?? [],
        "node",
        ["nodes", nodeId, "context"],
        options,
        diagnostics,
      ),
    ],
    instructions: layers.project?.instructions ?? "inherit",
    diagnostics,
  };
};

/**
 * The context diagnostics of a whole workflow, for `ork validate`: every Claude
 * node's layers resolved against the project, each finding once.
 */
export const contextDiagnostics = (
  workflow: Workflow,
  options: Omit<ContextOptions, "workflow" | "nodeId" | "checkout">,
): Diagnostic[] => {
  const seen = new Map<string, Diagnostic>();
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    if (!isClaudeNode(node) || node.type === "claude.subagent") continue;
    const stack = resolveContext({
      ...options,
      workflow,
      nodeId,
      checkout: options.projectRoot,
    });
    for (const diagnostic of stack.diagnostics) {
      seen.set(
        `${diagnostic.code} ${diagnostic.path.join(".")} ${diagnostic.message}`,
        diagnostic,
      );
    }
  }
  return [...seen.values()];
};
