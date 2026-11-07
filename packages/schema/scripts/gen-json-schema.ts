/**
 * @file Writes workflow.schema.json, agent.schema.json, project.schema.json,
 *   settings.schema.json and triggers.schema.json, the JSON Schemas editors use
 *   for autocomplete on `*.ork.yaml` workflow files, `*.agent.yaml` agent
 *   sidecars, `.ork/project.yaml`, `~/.ork/settings.yaml` and
 *   `.ork/triggers.yaml`. Run with `pnpm --dir packages/schema
 *   gen:json-schema`; a test fails when a committed file is stale.
 */

import { writeFileSync } from "node:fs";

import {
  renderAgentJsonSchema,
  renderJsonSchema,
  renderProjectJsonSchema,
  renderSettingsJsonSchema,
  renderTriggersJsonSchema,
} from "../src/json-schema.ts";

for (const [file, render] of [
  ["../workflow.schema.json", renderJsonSchema],
  ["../agent.schema.json", renderAgentJsonSchema],
  ["../project.schema.json", renderProjectJsonSchema],
  ["../settings.schema.json", renderSettingsJsonSchema],
  ["../triggers.schema.json", renderTriggersJsonSchema],
] as const) {
  const target = new URL(file, import.meta.url);
  writeFileSync(target, render());
  process.stdout.write(`wrote ${target.pathname}\n`);
}
