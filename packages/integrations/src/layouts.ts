/**
 * @file The registry of agent-tool layouts: where each coding-agent tool keeps
 *   a project's agents and skills (`.claude/agents`, `.opencode/skills`, …).
 *   Ork collects a project's agents from these folders and, with `ork link`,
 *   points them at `.ork/`. Add a tool by listing its layout here.
 */

export type AgentToolLayout = {
  /** Short id, e.g. `claude`. */
  id: string;
  /** What the user knows it as. */
  name: string;
  /** Project-relative folder of agent files (`<name>.md`), if the tool has one. */
  agents?: string;
  /** Project-relative folder of skills (`<name>/SKILL.md`), if it has one. */
  skills?: string;
};

/** Ork's own folders: the origin the tools' folders can link to. */
export const ORK_LAYOUT = {
  id: "ork",
  name: "Ork",
  agents: ".ork/agents",
  skills: ".ork/skills",
} as const satisfies AgentToolLayout;

/**
 * The tools' layouts, highest precedence first: when two different files give
 * an agent the same name, the earlier folder's wins (after `.ork/` itself).
 */
export const AGENT_TOOL_LAYOUTS: readonly AgentToolLayout[] = [
  {
    id: "claude",
    name: "Claude Code",
    agents: ".claude/agents",
    skills: ".claude/skills",
  },
  { id: "agents", name: "Agent Skills", skills: ".agents/skills" },
  {
    id: "opencode",
    name: "OpenCode",
    agents: ".opencode/agents",
    skills: ".opencode/skills",
  },
  {
    id: "ai",
    name: ".ai knowledge layer",
    agents: ".ai/agents",
    skills: ".ai/skills",
  },
];
