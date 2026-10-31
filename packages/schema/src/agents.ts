/**
 * @file Agents: who fills a Claude node. An agent is a portable `<name>.md`
 *   (frontmatter `name` and `description`, the role as its body) that every
 *   coding-agent tool reads, plus an optional `<name>.agent.yaml` sidecar
 *   beside it with Ork's settings, which other tools never see. A workflow can
 *   also define agents inline under `agents:`. This module holds the Zod
 *   models, reading and writing both files, and their canonical form.
 */

import { parseDocument, stringify } from "yaml";
import { z } from "zod";

import {
  AGENT_SETTING_KEYS,
  AgentNameSchema,
  agentSettings,
  ModelSchema,
} from "./nodes.ts";

/** The sidecar: Ork's settings for an agent, beside its markdown. */
export const AgentSettingsSchema = z.strictObject(agentSettings);
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

/** A whole agent: what it is for, its role, and its settings. */
export const AgentSchema = z.strictObject({
  description: z
    .string()
    .optional()
    .describe("When to use this agent; tools show it when choosing one."),
  instructions: z
    .string()
    .optional()
    .describe("The agent's role, appended to the system prompt of its nodes."),
  ...agentSettings,
});
export type Agent = z.infer<typeof AgentSchema>;

export const AGENT_FILE_SUFFIX = ".md";
export const AGENT_SIDECAR_SUFFIX = ".agent.yaml";

export const AGENT_SCHEMA_URL =
  "https://raw.githubusercontent.com/mimshins/ork/main/packages/schema/agent.schema.json";

export type AgentFileResult =
  | { ok: true; name: string; agent: Agent }
  | { ok: false; message: string };

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

const issueText = (error: z.ZodError): string =>
  error.issues
    .map(issue =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.join(".")}: ${issue.message}`,
    )
    .join("; ");

/** The sidecar's settings, or why they are invalid. */
export const parseAgentSettings = (
  text: string,
): { ok: true; settings: AgentSettings } | { ok: false; message: string } => {
  const doc = parseDocument(text);
  const [problem] = doc.errors;
  if (problem !== undefined) return { ok: false, message: problem.message };
  const raw: unknown = doc.toJS();
  const result = AgentSettingsSchema.safeParse(raw ?? {});
  return result.success
    ? { ok: true, settings: result.data }
    : { ok: false, message: issueText(result.error) };
};

const stringField = (
  data: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = data[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
};

/**
 * Reads an agent from its markdown and optional sidecar. `fallbackName` (the
 * file's base name) is used when the frontmatter has no `name`. A Claude Code
 * `model` in the frontmatter is honoured (not `inherit`); the sidecar's wins.
 * Other tools' frontmatter keys are left to those tools.
 */
export const parseAgentFile = (
  markdown: string,
  sidecar: string | undefined,
  fallbackName: string,
): AgentFileResult => {
  const match = FRONTMATTER.exec(markdown);
  let data: Record<string, unknown> = {};
  if (match !== null) {
    const doc = parseDocument(match[1] ?? "");
    const [problem] = doc.errors;
    if (problem !== undefined) {
      return { ok: false, message: `frontmatter: ${problem.message}` };
    }
    const raw: unknown = doc.toJS();
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      data = Object.fromEntries(Object.entries(raw));
    }
  }
  const name = stringField(data, "name") ?? fallbackName;
  if (!AgentNameSchema.safeParse(name).success) {
    return {
      ok: false,
      message: `"${name}" is not an agent name (lowercase letters, digits, '-' and '_')`,
    };
  }
  const agent: Agent = {};
  const description = stringField(data, "description");
  if (description !== undefined) agent.description = description;
  const body = markdown.slice(match?.[0].length ?? 0).trim();
  if (body !== "") agent.instructions = body;
  const model = stringField(data, "model");
  if (model !== undefined && model !== "inherit") {
    agent.model = ModelSchema.parse(model);
  }
  if (sidecar !== undefined) {
    const settings = parseAgentSettings(sidecar);
    if (!settings.ok) {
      return {
        ok: false,
        message: `${AGENT_SIDECAR_SUFFIX}: ${settings.message}`,
      };
    }
    Object.assign(agent, settings.settings);
  }
  return { ok: true, name, agent };
};

/** The agent's settings alone, in canonical key order. */
export const settingsOf = (agent: Agent): AgentSettings => {
  const settings: Record<string, unknown> = {};
  for (const key of AGENT_SETTING_KEYS) {
    if (agent[key] !== undefined) settings[key] = agent[key];
  }
  return AgentSettingsSchema.parse(settings);
};

/**
 * Writes an agent as its two files: the portable markdown, and the sidecar
 * (`null` when the agent has no Ork settings). Canonical and byte-stable.
 */
export const serializeAgent = (
  name: string,
  agent: Agent,
): { markdown: string; sidecar: string | null } => {
  const frontmatter = stringify(
    agent.description === undefined
      ? { name }
      : { name, description: agent.description },
    { lineWidth: 0 },
  );
  const body = agent.instructions?.trim() ?? "";
  const markdown = `---\n${frontmatter}---\n${body === "" ? "" : `\n${body}\n`}`;
  const settings = settingsOf(agent);
  const sidecar =
    Object.keys(settings).length === 0
      ? null
      : `# yaml-language-server: $schema=${AGENT_SCHEMA_URL}\n${stringify(settings, { lineWidth: 0, indent: 2 })}`;
  return { markdown, sidecar };
};
