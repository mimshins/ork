/**
 * @file What keeps a session clean of the machine's Claude setup, on both
 *   drivers (ADR-065): no MCP server but Ork's, Claude Code's auto-memory off,
 *   and the per-machine sections of its system prompt out of the cached prefix.
 *   A run started with `--machine-claude` loads the machine's MCP servers and
 *   memory again; a spec that asks for strict MCP itself (a leader's question
 *   fork, ADR-063) keeps it either way.
 */

import type { SessionSpec } from "@krapht/ork-core";

import { cacheEnv } from "./cache-env.ts";

/** Claude Code's switch that turns its auto-memory off. */
export const NO_AUTO_MEMORY = "CLAUDE_CODE_DISABLE_AUTO_MEMORY";

/**
 * The CLI flag that moves the per-machine sections (working directory, memory
 * path, git status) out of the system prompt; the SDK's
 * `excludeDynamicSections`.
 */
export const EXCLUDE_DYNAMIC_SECTIONS =
  "--exclude-dynamic-system-prompt-sections";

/** Whether the session loads no MCP server but Ork's. */
export const strictMcpOf = (
  spec: Pick<SessionSpec, "tools" | "machineClaude">,
): boolean => spec.tools.strictMcp === true || spec.machineClaude !== true;

/** The variables that keep the machine's auto-memory out of a session. */
export const memoryEnv = (
  spec: Pick<SessionSpec, "machineClaude">,
): Record<string, string> =>
  spec.machineClaude === true ? {} : { [NO_AUTO_MEMORY]: "1" };

/** Everything a session adds to its driver's environment. */
export const driverEnv = (
  spec: Pick<SessionSpec, "promptCache" | "machineClaude">,
): Record<string, string> => ({ ...cacheEnv(spec), ...memoryEnv(spec) });
