/**
 * @file Writes workflow.schema.json and agent.schema.json, the JSON Schemas
 *   editors use for autocomplete on `*.ork.yaml` workflow files and
 *   `*.agent.yaml` agent sidecars. Run with `pnpm --dir packages/schema
 *   gen:json-schema`; a test fails when the committed file is stale.
 */

import { writeFileSync } from "node:fs";

import { renderAgentJsonSchema, renderJsonSchema } from "../src/json-schema.ts";

for (const [file, render] of [
  ["../workflow.schema.json", renderJsonSchema],
  ["../agent.schema.json", renderAgentJsonSchema],
] as const) {
  const target = new URL(file, import.meta.url);
  writeFileSync(target, render());
  process.stdout.write(`wrote ${target.pathname}\n`);
}
