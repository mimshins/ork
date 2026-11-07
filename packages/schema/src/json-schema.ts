/**
 * @file Renders the published JSON Schemas for workflow files, agent sidecars,
 *   project rules, user settings and triggers from the Zod models.
 */

import { z } from "zod";

import { AGENT_SCHEMA_URL, AgentSettingsSchema } from "./agents.ts";
import {
  PROJECT_SCHEMA_URL,
  ProjectSchema,
  SETTINGS_SCHEMA_URL,
  UserSettingsSchema,
} from "./project.ts";
import { TRIGGERS_SCHEMA_URL, TriggersFileSchema } from "./triggers.ts";
import { WorkflowSchema } from "./workflow.ts";
import { SCHEMA_URL } from "./yaml.ts";

/** The published JSON Schema for workflow files, as formatted JSON text. */
export const renderJsonSchema = (): string => {
  const schema = z.toJSONSchema(WorkflowSchema, {
    io: "input",
    target: "draft-2020-12",
  });
  return `${JSON.stringify(
    { ...schema, $id: SCHEMA_URL, title: "Ork workflow" },
    undefined,
    2,
  )}\n`;
};

/** The published JSON Schema for agent sidecars (`<name>.agent.yaml`). */
export const renderAgentJsonSchema = (): string => {
  const schema = z.toJSONSchema(AgentSettingsSchema, {
    io: "input",
    target: "draft-2020-12",
  });
  return `${JSON.stringify(
    { ...schema, $id: AGENT_SCHEMA_URL, title: "Ork agent settings" },
    undefined,
    2,
  )}\n`;
};

/** The published JSON Schema for the user's `~/.ork/settings.yaml`. */
export const renderSettingsJsonSchema = (): string => {
  const schema = z.toJSONSchema(UserSettingsSchema, {
    io: "input",
    target: "draft-2020-12",
  });
  return `${JSON.stringify(
    { ...schema, $id: SETTINGS_SCHEMA_URL, title: "Ork user settings" },
    undefined,
    2,
  )}\n`;
};

/** The published JSON Schema for a project's `.ork/project.yaml`. */
export const renderProjectJsonSchema = (): string => {
  const schema = z.toJSONSchema(ProjectSchema, {
    io: "input",
    target: "draft-2020-12",
  });
  return `${JSON.stringify(
    { ...schema, $id: PROJECT_SCHEMA_URL, title: "Ork project rules" },
    undefined,
    2,
  )}\n`;
};

/** The published JSON Schema for a project's `.ork/triggers.yaml` (RFC-011). */
export const renderTriggersJsonSchema = (): string => {
  const schema = z.toJSONSchema(TriggersFileSchema, {
    io: "input",
    target: "draft-2020-12",
  });
  return `${JSON.stringify(
    { ...schema, $id: TRIGGERS_SCHEMA_URL, title: "Ork triggers" },
    undefined,
    2,
  )}\n`;
};
