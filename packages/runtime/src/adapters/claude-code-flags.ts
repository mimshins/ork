/**
 * @file What carries Ork's token into a `claude` session: its MCP config, its
 *   settings with the hold hook, and the wiring that writes both into private
 *   files (0700 folder, 0600 files) so the token is never on the argv, where
 *   other users of the machine could read it.
 */

import type { SessionSpec } from "@krapht/ork-core";

import type { McpWiring, OrkEndpoint } from "../adapter.ts";
import { makeSecretFolder } from "../secret-file.ts";
import { ORK_SERVER } from "../tools/tool.ts";

/**
 * Per-request timeout for Ork's MCP server, in ms. The CLI otherwise gives an
 * HTTP server's request 60 seconds and drops a call silent for 5 minutes, and
 * `delegate` waits for whole child sessions (the per-server `timeout` raises
 * both; `MCP_TOOL_TIMEOUT` still caps it).
 */
export const ORK_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** Claude Code cancels a hook after this; a held call must answer before. */
export const HOOK_TIMEOUT_S = 600;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The node's `--settings` with Ork's `PreToolUse` HTTP hook added: before every
 * tool call, pre-approved ones included, the session asks whether its node may
 * go on. Its `PostToolUse` hook after a Bash call frees the call's slot.
 */
export const withHoldHook = (
  settings: Record<string, unknown> | undefined,
  holdUrl: string,
  token: string,
): Record<string, unknown> => {
  const hooks = isRecord(settings?.["hooks"]) ? settings["hooks"] : {};
  const listed = (event: string): unknown[] => {
    const own: unknown = hooks[event];
    return Array.isArray(own) ? [...(own as unknown[])] : [];
  };
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
      PreToolUse: [...listed("PreToolUse"), { matcher: "*", hooks: [hook] }],
      // Frees a heavy Bash call's slot once the call is done.
      PostToolUse: [
        ...listed("PostToolUse"),
        { matcher: "Bash", hooks: [hook] },
      ],
    },
  };
};

/** The session's `--mcp-config`: its servers, and Ork's with the token. */
export const mcpConfigOf = (spec: SessionSpec, mcp: OrkEndpoint) => ({
  mcpServers: {
    ...spec.mcpServers,
    [ORK_SERVER]: {
      type: "http",
      url: mcp.url,
      headers: { Authorization: `Bearer ${mcp.token}` },
      timeout: ORK_TOOL_TIMEOUT_MS,
    },
  },
});

/** The session's `--settings`, with the hold hook (and its token) when held. */
export const settingsOf = (
  spec: SessionSpec,
  mcp: OrkEndpoint,
): Record<string, unknown> | undefined =>
  mcp.holdUrl === undefined
    ? spec.settings
    : withHoldHook(spec.settings, mcp.holdUrl, mcp.token);

/** The flags whose values carry Ork's token. */
const SECRET_FLAGS = new Set(["--mcp-config", "--settings"]);

/**
 * `args` without the flags that carry Ork's token: a process's arguments can be
 * read by other users of the machine, so the session passes them as files.
 */
export const withoutSecretFlags = (args: readonly string[]): string[] =>
  args.filter(
    (arg, at) =>
      !SECRET_FLAGS.has(arg) && !SECRET_FLAGS.has(args[at - 1] ?? ""),
  );

/**
 * Writes the session's MCP config and settings into a private folder (0700,
 * each file 0600) and passes their paths; the folder goes when the session
 * ends.
 */
export const secretFlags: McpWiring = {
  kind: "flag",
  wire: (spec, endpoint) => {
    const folder = makeSecretFolder();
    try {
      const config = JSON.stringify(mcpConfigOf(spec, endpoint));
      const args = ["--mcp-config", folder.write("mcp.json", config)];
      const settings = settingsOf(spec, endpoint);
      if (settings !== undefined) {
        args.push(
          "--settings",
          folder.write("settings.json", JSON.stringify(settings)),
        );
      }
      return Promise.resolve({
        args,
        env: {},
        release: () => {
          folder.remove();
          return Promise.resolve();
        },
      });
    } catch (error) {
      folder.remove();
      throw error;
    }
  },
};
