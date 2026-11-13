/**
 * @file The `claude-code` adapter: the user's own `claude -p` in stream-json
 *   mode. Its Command is `buildCliArgs` and the node's tool rules, with Ork's
 *   MCP endpoint and settings, which carry its token, passed as private files
 *   (`--mcp-config`, `--settings`, the `flag` wiring), not on the argv, with
 *   permission prompts sent to Ork's `permission` tool. Sessions start clean of
 *   the machine's Claude setup unless the run asks for it (ADR-065). A node
 *   that can be paused gets a `PreToolUse` HTTP hook on the endpoint: a short
 *   pause holds the call, a long one defers it (ADR-041). Its events and usage
 *   are read in `claude-code-events.ts`.
 */

import type { AgentRuntime, SessionSpec } from "@krapht/ork-core";

import type { CliAdapter, HoldHook, OrkEndpoint } from "../adapter.ts";
import type { HoldAnswer } from "../hold.ts";
import { createSessionRuntime, type RunnerOptions } from "../session-runner.ts";
import { toolId } from "../tools/tool.ts";
import {
  claudeDecoder,
  claudeUsage,
  decodeClaudeLine,
} from "./claude-code-events.ts";
import {
  HOOK_TIMEOUT_S,
  mcpConfigOf,
  secretFlags,
  settingsOf,
  withoutSecretFlags,
} from "./claude-code-flags.ts";

export type CliRuntimeOptions = RunnerOptions;

/** Claude Code's switch for the one-hour prompt cache. */
export const PROMPT_CACHE_1H = "ENABLE_PROMPT_CACHING_1H";

/** Claude Code's switch that turns its auto-memory off. */
export const NO_AUTO_MEMORY = "CLAUDE_CODE_DISABLE_AUTO_MEMORY";

/**
 * The CLI flag that moves the per-machine sections (working directory, memory
 * path, git status) out of the system prompt.
 */
export const EXCLUDE_DYNAMIC_SECTIONS =
  "--exclude-dynamic-system-prompt-sections";

/** How long a hook holds a call before it defers it instead. */
export const HOLD_WINDOW_MS = (HOOK_TIMEOUT_S - 60) * 1000;

/** The variables a session's prompt cache asks of Claude Code. */
export const cacheEnv = (
  spec: Pick<SessionSpec, "promptCache">,
): Record<string, string> =>
  spec.promptCache === "1h" ? { [PROMPT_CACHE_1H]: "1" } : {};

/** Whether the session loads no MCP server but Ork's. */
export const strictMcpOf = (
  spec: Pick<SessionSpec, "tools" | "machineClaude">,
): boolean => spec.tools.strictMcp === true || spec.machineClaude !== true;

/** The variables that keep the machine's auto-memory out of a session. */
export const memoryEnv = (
  spec: Pick<SessionSpec, "machineClaude">,
): Record<string, string> =>
  spec.machineClaude === true ? {} : { [NO_AUTO_MEMORY]: "1" };

/** Claude Code's default timeout for a Bash call, in milliseconds. */
export const BASH_TIMEOUT = "BASH_DEFAULT_TIMEOUT_MS";

/**
 * Ten minutes, Claude Code's own most for a Bash call. At its default of two, a
 * longer command (a typecheck of the workspace) moves to the background, and
 * the session then polls it with `sleep`, `until` or `Monitor`, which ask.
 */
export const BASH_TIMEOUT_MS = 10 * 60 * 1000;

/** The variables that let a session's Bash calls run to the end in front. */
export const bashEnv = (): Record<string, string> => ({
  [BASH_TIMEOUT]: String(BASH_TIMEOUT_MS),
});

/** Everything a session adds to its driver's environment. */
export const driverEnv = (
  spec: Pick<SessionSpec, "promptCache" | "machineClaude">,
): Record<string, string> => ({
  ...bashEnv(),
  ...cacheEnv(spec),
  ...memoryEnv(spec),
});

/** A later message goes in at the next step, even mid-turn. */
const userLine = (text: string, later = false): string =>
  `${JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    ...(later ? { priority: "next" } : {}),
  })}\n`;

/** The hook's answer: nothing to say for "go", the deferral otherwise. */
export const hookOutput = (answer: HoldAnswer): Record<string, unknown> =>
  answer === "go"
    ? {}
    : {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "defer",
          permissionDecisionReason:
            "Ork paused this node; it goes on from this call when it continues.",
        },
      };

const claudeHold: HoldHook = { answer: hookOutput, windowMs: HOLD_WINDOW_MS };

/**
 * The `claude -p` arguments for a session spec. The brief goes on stdin;
 * `allowed` are the Ork tools that need no permission prompt.
 */
export const buildCliArgs = (
  spec: SessionSpec,
  mcp: OrkEndpoint,
  allowed: readonly string[],
): string[] => {
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--setting-sources",
    spec.settingSources.join(","),
    "--append-system-prompt",
    spec.systemAppend,
    EXCLUDE_DYNAMIC_SECTIONS,
    "--permission-mode",
    spec.permissionMode,
    "--json-schema",
    JSON.stringify(spec.reportSchema),
    "--mcp-config",
    JSON.stringify(mcpConfigOf(spec, mcp)),
    "--permission-prompt-tool",
    toolId("permission"),
    "--allowedTools",
    [...spec.tools.allow, ...allowed].join(","),
  ];
  if (spec.tools.only !== undefined) {
    args.push("--tools", spec.tools.only.join(","));
  }
  if (strictMcpOf(spec)) args.push("--strict-mcp-config");
  if (spec.agents !== undefined) {
    args.push("--agents", JSON.stringify(spec.agents));
  }
  if (spec.tools.deny.length > 0) {
    args.push("--disallowedTools", spec.tools.deny.join(","));
  }
  if (spec.model !== undefined) args.push("--model", spec.model);
  if (spec.effort !== undefined) args.push("--effort", spec.effort);
  if (spec.maxTurns !== undefined) {
    args.push("--max-turns", String(spec.maxTurns));
  }
  if (spec.budgetUsd !== undefined) {
    args.push("--max-budget-usd", String(spec.budgetUsd));
  }
  if (spec.resume !== undefined) args.push("--resume", spec.resume);
  if (spec.resume !== undefined && spec.fork === true) {
    args.push("--fork-session");
  }
  for (const dir of spec.plugins ?? []) args.push("--plugin-dir", dir);
  const settings = settingsOf(spec, mcp);
  if (settings !== undefined) {
    args.push("--settings", JSON.stringify(settings));
  }
  return args;
};

/** `claude`, as the session runner's strategies. */
export const claudeCodeAdapter: CliAdapter = {
  driver: "claude-code",
  command: {
    bin: "claude",
    // The token's flags come from the wiring, as files.
    args: (spec, leg) =>
      withoutSecretFlags(buildCliArgs(spec, leg.endpoint, leg.allowed)),
    input: userLine,
  },
  decode: decodeClaudeLine,
  legDecoder: claudeDecoder,
  mcp: secretFlags,
  permissions: { kind: "callback", denyByDefault: false },
  usage: claudeUsage,
  context: {
    instructions: ["CLAUDE.md", "AGENTS.md"],
    skills: ".claude/skills",
    agents: ".claude/agents",
    env: driverEnv,
  },
  hold: claudeHold,
};

/**
 * Drives a session with the user's own `claude` CLI in print mode, logged in by
 * the user. Ork never reads or passes its credentials.
 */
export const createCliRuntime = (
  options: CliRuntimeOptions = {},
): AgentRuntime => createSessionRuntime(claudeCodeAdapter, options);
