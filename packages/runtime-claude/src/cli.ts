/**
 * @file The CLI driver: runs a session through the user's own `claude -p` in
 *   stream-json mode, with Ork's tools served by a local MCP server.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import type {
  ClaudeRuntime,
  RuntimeEvent,
  Session,
  SessionSpec,
} from "@krapht/ork-core";

import { type OrkMcpEndpoint, startOrkMcpHttp } from "./mcp-http.ts";
import { driverFailure, normalize, withDriver } from "./normalize.ts";
import { orkTools, preapprovedTools } from "./tools/registry.ts";
import { ORK_SERVER, toolId } from "./tools/tool.ts";

export type CliRuntimeOptions = {
  /** The program to run; defaults to `claude` on the PATH. */
  bin?: string;
  env?: Readonly<Record<string, string | undefined>>;
};

const STDERR_LINES = 20;

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
  mcp: Pick<OrkMcpEndpoint, "url" | "token">,
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
  for (const dir of spec.plugins ?? []) args.push("--plugin-dir", dir);
  if (spec.settings !== undefined) {
    args.push("--settings", JSON.stringify(spec.settings));
  }
  return args;
};

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
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
    // Stream-json lines, written once the process is up.
    const pending: string[] = [userLine(spec.prompt)];
    let write: ((line: string) => void) | undefined;
    let stop: (() => void) | undefined;

    const events = async function* (): AsyncGenerator<RuntimeEvent> {
      const tools = orkTools({ nodeId: spec.nodeId, driver: "cli", ports });
      const mcp = await startOrkMcpHttp(tools);
      const args = buildCliArgs(spec, mcp, preapprovedTools(tools));
      const child = spawn(options.bin ?? "claude", args, {
        cwd: spec.cwd,
        env: { ...(options.env ?? process.env) },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exited = new Promise<number | null>(resolve => {
        child.on("close", code => {
          resolve(code);
        });
      });
      const spawnError = new Promise<Error>(resolve => {
        child.on("error", resolve);
      });
      const stderr: string[] = [];
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr.push(...chunk.split("\n").filter(l => l.trim() !== ""));
        stderr.splice(0, Math.max(0, stderr.length - STDERR_LINES));
      });

      write = line => {
        if (child.stdin.writable) child.stdin.write(line);
      };
      stop = () => {
        child.kill("SIGINT");
      };
      for (const line of pending.splice(0)) write(line);

      let finished = false;
      try {
        const lines = createInterface({ input: child.stdout });
        for await (const line of lines) {
          for (const event of normalize(parseLine(line))) {
            if (event.type === "session.finished") {
              finished = true;
              // The first result ends the session; `--resume` continues it.
              child.stdin.end();
            }
            yield withDriver(event, "cli");
          }
        }
        const code = await Promise.race([
          exited,
          spawnError.then(error => error),
        ]);
        if (!finished) {
          const reason =
            code instanceof Error
              ? `could not start ${options.bin ?? "claude"}: ${code.message}`
              : (stderr.at(-1) ?? `claude exited with code ${String(code)}`);
          yield driverFailure(reason);
        }
      } finally {
        if (child.exitCode === null) child.kill();
        await mcp.close();
      }
    };

    return {
      events: events(),
      send: text => {
        const line = userLine(text, true);
        if (write === undefined) pending.push(line);
        else write(line);
      },
      interrupt: () => {
        stop?.();
        return Promise.resolve();
      },
    };
  },
});
