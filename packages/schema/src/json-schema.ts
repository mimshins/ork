/**
 * @file Renders the published JSON Schemas for workflow files and agent
 *   sidecars from the Zod models.
 */

import { z } from "zod";

import { AGENT_SCHEMA_URL, AgentSettingsSchema } from "./agents.ts";
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
