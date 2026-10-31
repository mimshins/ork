/**
 * @file Writes workflow.schema.json, agent.schema.json and project.schema.json,
 *   the JSON Schemas editors use for autocomplete on `*.ork.yaml` workflow
 *   files, `*.agent.yaml` agent sidecars and `.ork/project.yaml`. Run with
 *   `pnpm --dir packages/schema gen:json-schema`; a test fails when the
 *   committed file is stale.
 */

import { writeFileSync } from "node:fs";

import {
  renderAgentJsonSchema,
  renderJsonSchema,
  renderProjectJsonSchema,
} from "../src/json-schema.ts";

for (const [file, render] of [
  ["../workflow.schema.json", renderJsonSchema],
  ["../agent.schema.json", renderAgentJsonSchema],
  ["../project.schema.json", renderProjectJsonSchema],
] as const) {
  const target = new URL(file, import.meta.url);
  writeFileSync(target, render());
  process.stdout.write(`wrote ${target.pathname}\n`);
}
