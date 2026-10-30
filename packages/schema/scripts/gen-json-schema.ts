/**
 * @file Writes workflow.schema.json, the JSON Schema editors use for
 *   autocomplete on `*.ork.yaml` files. Run with `pnpm --dir packages/schema
 *   gen:json-schema`; a test fails when the committed file is stale.
 */

import { writeFileSync } from "node:fs";

import { renderJsonSchema } from "../src/json-schema.ts";

const target = new URL("../workflow.schema.json", import.meta.url);
writeFileSync(target, renderJsonSchema());
process.stdout.write(`wrote ${target.pathname}\n`);
