/**
 * @file `@krapht/ork-integrations`: the registries of Ork's integrations (the
 *   user's CLI tools) and Claude drivers. Everything that names a tool or a
 *   driver (the workflow schema, the tool executor, `ork doctor`, `ork run`)
 *   reads these lists instead of naming them itself (ADR-022).
 */

import { aws } from "./aws.ts";
import { gh } from "./gh.ts";
import type { Integration } from "./integration.ts";
import { shell } from "./shell.ts";

export * from "./drivers.ts";
export * from "./integration.ts";
export * from "./json.ts";

/**
 * The registry of tool integrations, in the order `ork doctor` and the JSON
 * Schema list them. Add an integration by writing its adapter and listing it
 * here.
 */
export const INTEGRATIONS = [gh, aws, shell] as const;

export const TOOL_PREFIX = "tool.";

/** The integration behind a node type such as `tool.gh`, if any. */
export const integrationFor = (type: string): Integration | undefined =>
  type.startsWith(TOOL_PREFIX)
    ? INTEGRATIONS.find(i => `${TOOL_PREFIX}${i.id}` === type)
    : undefined;

export { aws, gh, shell };
