import type { ClaudeNode } from "@krapht/ork-schema";

import { REPORT_STATUSES } from "../graph/types.ts";
import type { NodeReport, ReportStatus } from "./types.ts";

type JsonSchema = Record<string, unknown>;

const entries = (value: object): [string, unknown][] => Object.entries(value);

const PRIMITIVES = new Set(["string", "number", "integer", "boolean"]);

/**
 * One `output.schema` field as JSON Schema: a list is an enum, a primitive name
 * is that type, an object is taken as JSON Schema already.
 */
const fieldSchema = (value: unknown): JsonSchema => {
  if (Array.isArray(value)) return { enum: value };
  if (typeof value === "string" && PRIMITIVES.has(value))
    return { type: value };
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(entries(value));
  }
  return {};
};

/** JSON Schema of the structured report a Claude node must end with. */
export const reportSchemaFor = (node: ClaudeNode): JsonSchema => {
  const extra = node.output?.schema ?? {};
  const properties: Record<string, JsonSchema> = {
    status: {
      enum: [...REPORT_STATUSES],
      description:
        "pass: the task is done and meets the brief; changes_requested: a review found work to redo; fail: you could not do it; done: finished, nothing to judge.",
    },
    summary: {
      type: "string",
      description: "What you did and found, in a few sentences.",
    },
    artifacts: {
      type: "object",
      additionalProperties: { type: "string" },
      description:
        "Name -> repository-relative path of each file you produced.",
    },
    branch: {
      type: "string",
      description: "The git branch holding your changes, if any.",
    },
  };
  for (const [name, value] of Object.entries(extra)) {
    properties[name] = fieldSchema(value);
  }
  return {
    type: "object",
    properties,
    required: ["status", "summary", ...Object.keys(extra)],
    additionalProperties: false,
  };
};

const isStatus = (value: unknown): value is ReportStatus =>
  typeof value === "string" &&
  (REPORT_STATUSES as readonly string[]).includes(value);

const STANDARD = new Set(["status", "summary", "artifacts", "branch"]);

/** Reads a driver's structured output as a report, or `null` if it is not one. */
export const parseReport = (value: unknown): NodeReport | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = Object.fromEntries(entries(value));
  const { status, summary, artifacts, branch } = record;
  if (!isStatus(status) || typeof summary !== "string") return null;

  const paths: Record<string, string> = {};
  if (artifacts !== null && typeof artifacts === "object") {
    for (const [name, path] of entries(artifacts)) {
      if (typeof path === "string") paths[name] = path;
    }
  }
  const report: NodeReport = {
    status,
    summary,
    artifacts: paths,
    fields: Object.fromEntries(
      Object.entries(record).filter(([key]) => !STANDARD.has(key)),
    ),
  };
  if (typeof branch === "string" && branch !== "") report.branch = branch;
  return report;
};
