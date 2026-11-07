/**
 * @file The CLI driver: runs a session through the user's own `claude -p` in
 *   stream-json mode, with Ork's tools served by a local MCP server. A node
 *   that can be paused gets a `PreToolUse` HTTP hook on the same server: a
 *   short pause holds the call, a long one defers it and resumes the session
 *   when the node continues (ADR-041).
 */

import type {
  ClaudeRuntime,
  RuntimeEvent,
  Session,
  SessionSpec,
  SessionUsage,
} from "@krapht/ork-core";

import { cacheEnv } from "./cache-env.ts";
import { runLeg } from "./cli-leg.ts";
import { addUsage, holdAtTool, hookOutput, withHoldHook } from "./hold.ts";
import { type OrkMcpEndpoint, startOrkMcpHttp } from "./mcp-http.ts";
import { driverFailure } from "./normalize.ts";
import { orkTools, preapprovedTools } from "./tools/registry.ts";
import { ORK_SERVER, toolId } from "./tools/tool.ts";

export type CliRuntimeOptions = {
  /** The program to run; defaults to `claude` on the PATH. */
  bin?: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** How long a held call waits before it defers (tests shorten it). */
  holdWindowMs?: number;
};

/**
 * Per-request timeout for Ork's MCP server, in ms. The CLI otherwise gives an
 * HTTP server's request 60 seconds and drops a call silent for 5 minutes, and
 * `delegate` waits for whole child sessions (the per-server `timeout` raises
 * both; `MCP_TOOL_TIMEOUT` still caps it).
 */
export const ORK_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** A later message goes in at the next step, even mid-turn. */
const userLine = (text: string, later = false): string =>
  `${JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    ...(later ? { priority: "next" } : {}),
  })}\n`;

/**
 * The `claude -p` arguments for a session spec. The brief goes on stdin;
 * `allowed` are the Ork tools that need no permission prompt.
 */
export const buildCliArgs = (
  spec: SessionSpec,
  mcp: Pick<OrkMcpEndpoint, "url" | "token"> & { holdUrl?: string },
  allowed: readonly string[],
): string[] => {
  const mcpConfig = {
    mcpServers: {
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
  if (spec.tools.strictMcp === true) args.push("--strict-mcp-config");
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

/**
 * Drives a session with the user's own `claude` CLI in print mode, logged in by
 * the user. Ork never reads or passes its credentials.
 */
export const createCliRuntime = (
  options: CliRuntimeOptions = {},
): ClaudeRuntime => ({
  driver: "cli",
  start: (spec, ports): Session => {
    // Stream-json lines, written once a process is up.
    const pending: string[] = [userLine(spec.prompt)];
    let io: { write: (line: string) => void; stop: () => void } | undefined;
    const ended = new AbortController();
    /** The hold hook deferred a call in the running process. */
    let deferring = false;
    const { hold } = ports;

    const events = async function* (): AsyncGenerator<RuntimeEvent> {
      const tools = orkTools({ nodeId: spec.nodeId, driver: "cli", ports });
      const mcp = await startOrkMcpHttp(
        tools,
        hold === undefined
          ? undefined
          : async gone => {
              const answer = await holdAtTool(
                hold,
                AbortSignal.any([gone, ended.signal]),
                options.holdWindowMs,
              );
              if (answer === "defer") deferring = true;
              return hookOutput(answer);
            },
      );
      const allowed = preapprovedTools(tools);
      const endpoint =
        hold === undefined ? { url: mcp.url, token: mcp.token } : mcp;
      const legOf = (args: string[], carried: SessionUsage | undefined) =>
        runLeg({
          bin: options.bin ?? "claude",
          env: { ...(options.env ?? process.env), ...cacheEnv(spec) },
          cwd: spec.cwd,
          args,
          carried,
          pending,
          deferred: () => deferring,
          attach: attached => {
            io = attached;
          },
        });
      let args = buildCliArgs(spec, endpoint, allowed);
      let spent: SessionUsage | undefined;
      try {
        for (;;) {
          const leg = yield* legOf(args, spent);
          if (leg.kind === "failed") {
            yield driverFailure(leg.reason);
            return;
          }
          if (leg.kind === "finished") return;
          // Deferred: wait for the node to continue, then resume the session
          // with no new message; the pending call's hook then lets it run.
          deferring = false;
          spent = spent === undefined ? leg.usage : addUsage(spent, leg.usage);
          // oxlint-disable-next-line eslint/no-await-in-loop -- one leg at a time
          await hold?.wait("tool", ended.signal);
          if (ended.signal.aborted) {
            yield leg.last;
            return;
          }
          args = buildCliArgs(
            // A fork's later legs continue the fork, not the original.
            { ...spec, resume: leg.sessionId, fork: false },
            endpoint,
            allowed,
          );
        }
      } finally {
        await mcp.close();
      }
    };

    return {
      events: events(),
      send: text => {
        const line = userLine(text, true);
        if (io === undefined) pending.push(line);
        else io.write(line);
      },
      interrupt: () => {
        ended.abort();
        io?.stop();
        return Promise.resolve();
      },
    };
  },
});
