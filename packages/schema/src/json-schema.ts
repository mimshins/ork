import { z } from "zod";

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
