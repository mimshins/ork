/**
 * @file The `claude-code` adapter: the user's own `claude -p` in stream-json
 *   mode. Its Command is `buildCliArgs`, which also carries Ork's MCP endpoint
 *   (`--mcp-config`, the `flag` wiring) and the node's tool rules, with
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
import { ORK_SERVER, toolId } from "../tools/tool.ts";
import { claudeUsage, decodeClaudeLine } from "./claude-code-events.ts";

export type CliRuntimeOptions = RunnerOptions;

/**
 * Per-request timeout for Ork's MCP server, in ms. The CLI otherwise gives an
 * HTTP server's request 60 seconds and drops a call silent for 5 minutes, and
 * `delegate` waits for whole child sessions (the per-server `timeout` raises
 * both; `MCP_TOOL_TIMEOUT` still caps it).
 */
export const ORK_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

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

/** Claude Code cancels a hook after this; a held call must answer before. */
export const HOOK_TIMEOUT_S = 600;

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

/** Everything a session adds to its driver's environment. */
export const driverEnv = (
  spec: Pick<SessionSpec, "promptCache" | "machineClaude">,
): Record<string, string> => ({ ...cacheEnv(spec), ...memoryEnv(spec) });

/** A later message goes in at the next step, even mid-turn. */
const userLine = (text: string, later = false): string =>
  `${JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    ...(later ? { priority: "next" } : {}),
  })}\n`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The node's `--settings` with Ork's `PreToolUse` HTTP hook added: before every
 * tool call, pre-approved ones included, the session asks whether its node may
 * go on.
 */
export const withHoldHook = (
  settings: Record<string, unknown> | undefined,
  holdUrl: string,
  token: string,
): Record<string, unknown> => {
  const hooks = isRecord(settings?.["hooks"]) ? settings["hooks"] : {};
  const listed: unknown = hooks["PreToolUse"];
  const before: unknown[] = Array.isArray(listed)
    ? [...(listed as unknown[])]
    : [];
  const hook = {
    type: "http",
    url: holdUrl,
    headers: { Authorization: `Bearer ${token}` },
    timeout: HOOK_TIMEOUT_S,
  };
  return {
    ...settings,
    hooks: {
      ...hooks,
      PreToolUse: [...before, { matcher: "*", hooks: [hook] }],
    },
  };
};

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
  const mcpConfig = {
    mcpServers: {
      ...spec.mcpServers,
      [ORK_SERVER]: {
        type: "http",
        url: mcp.url,
        headers: { Authorization: `Bearer ${mcp.token}` },
        timeout: ORK_TOOL_TIMEOUT_MS,
      },
    },
  };
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
    JSON.stringify(mcpConfig),
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
  const settings =
    mcp.holdUrl === undefined
      ? spec.settings
      : withHoldHook(spec.settings, mcp.holdUrl, mcp.token);
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
    args: (spec, leg) => buildCliArgs(spec, leg.endpoint, leg.allowed),
    input: userLine,
  },
  decode: decodeClaudeLine,
  // The Command writes `--mcp-config` itself.
  mcp: {
    kind: "flag",
    wire: () =>
      Promise.resolve({ args: [], env: {}, release: () => Promise.resolve() }),
  },
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
