/**
 * @file The registry of tool integrations (ADR-022): every user CLI Ork can
 *   drive, and how a node type such as `tool.gh` finds its adapter.
 */

import { aws } from "./aws.ts";
import { gh } from "./gh.ts";
import { git } from "./git.ts";
import type { Integration } from "./integration.ts";
import { shell } from "./shell.ts";

/**
 * The registry of tool integrations, in the order `ork doctor` and the JSON
 * Schema list them. Add an integration by writing its adapter and listing it
 * here.
 */
export const INTEGRATIONS = [gh, aws, git, shell] as const;

export const TOOL_PREFIX = "tool.";

/** The integration behind a node type such as `tool.gh`, if any. */
export const integrationFor = (type: string): Integration | undefined =>
  type.startsWith(TOOL_PREFIX)
    ? INTEGRATIONS.find(i => `${TOOL_PREFIX}${i.id}` === type)
    : undefined;
