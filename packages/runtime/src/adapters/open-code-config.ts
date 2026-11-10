/**
 * @file The `open-code` adapter's session config (RFC-014, open questions 1 and
 *   3): Ork's MCP server with Code Mode off, so its tools reach the model as
 *   `ork_<tool>`; the node's MCP servers; a dedicated `ork` agent carrying the
 *   turn cap; and the full permission rule set, written every session because
 *   OpenCode runs a shell call when no rule says otherwise. The rules deny
 *   everything first, then open what the node allowed (last match wins).
 */

import path from "node:path";

import type { SessionSpec } from "@krapht/ork-core";

import type { OrkEndpoint } from "../adapter.ts";
import { ORK_SERVER } from "../tools/tool.ts";

export type Rule = {
  action: string;
  resource: string;
  effect: "allow" | "deny";
};

/** The agent every Ork session runs as. */
export const ORK_AGENT = "ork";

/** Claude Code tool names, as OpenCode's permission actions. */
const ACTIONS: Readonly<Record<string, string>> = {
  Read: "read",
  Glob: "glob",
  Grep: "grep",
  Edit: "edit",
  Write: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Bash: "shell",
  WebFetch: "webfetch",
  WebSearch: "websearch",
  Task: "subagent",
  Agent: "subagent",
  Skill: "skill",
  TodoWrite: "todowrite",
};

const BUILT_IN = new Set(Object.values(ACTIONS));

/** Actions whose resource is a path: a bare allow stays in the worktree. */
const PATH_ACTIONS = new Set(["read", "edit"]);

/** OpenCode's name for an MCP server's tool: other characters become `_`. */
const mcpAction = (server: string, tool: string): string =>
  `${server}_${tool}`.replaceAll(/[^A-Za-z0-9_*-]/gu, "_");

/** A shell rule's resource: Claude Code's `git status:*` is `git status *`. */
const shellResource = (spec: string): string => spec.replace(/:\*$/u, " *");

/**
 * One Claude Code rule (`Bash(git status:*)`, `Edit`, `mcp__github__*`) as an
 * OpenCode rule, or none for a tool OpenCode has no action for (still denied).
 */
export const ruleOf = (
  rule: string,
  effect: Rule["effect"],
  cwd: string,
): Rule | undefined => {
  const match = /^([^()]+)(?:\((.*)\))?$/su.exec(rule.trim());
  if (match === null) return undefined;
  const [, name = "", spec] = match;
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)(?:__(.*))?$/u.exec(name);
  if (mcp !== null) {
    const [, server = "", tool] = mcp;
    return { action: mcpAction(server, tool ?? "*"), resource: "*", effect };
  }
  const action = ACTIONS[name];
  if (action === undefined) return undefined;
  if (spec !== undefined) {
    const resource =
      action === "shell"
        ? shellResource(spec)
        : PATH_ACTIONS.has(action)
          ? path.resolve(cwd, spec)
          : spec;
    return { action, resource, effect };
  }
  const scoped = effect === "allow" && PATH_ACTIONS.has(action);
  return { action, resource: scoped ? `${cwd}/*` : "*", effect };
};

const rulesOf = (
  rules: readonly string[],
  effect: Rule["effect"],
  cwd: string,
): Rule[] => rules.flatMap(rule => ruleOf(rule, effect, cwd) ?? []);

/**
 * The session's rules, in order: deny everything; read in the worktree (as
 * Claude Code reads without asking); edits there under `acceptEdits`; the
 * node's allows (only its `only` tools, if it names them); Ork's tools; then
 * `.env` reads, plan mode's edits and shell, and the node's denies, refused.
 */
export const permissionRules = (spec: SessionSpec): Rule[] => {
  const { cwd, tools } = spec;
  const only =
    tools.only === undefined
      ? undefined
      : new Set(rulesOf(tools.only, "allow", cwd).map(r => r.action));
  // `only` limits the built-in tools, as `--tools` does; MCP tools pass.
  const inOnly = (rule: Rule): boolean =>
    only === undefined || only.has(rule.action) || !BUILT_IN.has(rule.action);
  const worktree = (action: string): Rule => ({
    action,
    resource: `${cwd}/*`,
    effect: "allow",
  });
  const allows = [
    worktree("read"),
    ...(spec.permissionMode === "acceptEdits" ? [worktree("edit")] : []),
    ...rulesOf(tools.allow, "allow", cwd),
  ].filter(rule => inOnly(rule));
  return [
    { action: "*", resource: "*", effect: "deny" },
    ...allows,
    { action: `${ORK_SERVER}_*`, resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "deny" },
    ...(spec.permissionMode === "plan"
      ? (["edit", "shell"] as const).map((action): Rule => ({
          action,
          resource: "*",
          effect: "deny",
        }))
      : []),
    ...rulesOf(tools.deny, "deny", cwd),
  ];
};

/**
 * A `.mcp.json` entry as an OpenCode server: `local` with a command, else
 * `remote`.
 */
const serverOf = (entry: Record<string, unknown>): Record<string, unknown> => {
  const { command, args, env, url, headers } = entry;
  const listed = Array.isArray(args) ? args.map(String) : [];
  return typeof command === "string"
    ? {
        type: "local",
        command: [command, ...listed],
        ...(env === undefined ? {} : { environment: env }),
        codemode: false,
      }
    : { type: "remote", url, oauth: false, codemode: false, headers };
};

/** The whole config file for one session. */
export const sessionConfig = (
  spec: SessionSpec,
  endpoint: OrkEndpoint,
  instructions: string,
): Record<string, unknown> => ({
  instructions: [instructions],
  mcp: {
    servers: {
      ...Object.fromEntries(
        Object.entries(spec.mcpServers ?? {}).map(([name, entry]) => [
          name,
          serverOf(entry),
        ]),
      ),
      [ORK_SERVER]: {
        type: "remote",
        url: endpoint.url,
        oauth: false,
        codemode: false,
        headers: { Authorization: `Bearer ${endpoint.token}` },
      },
    },
  },
  permissions: permissionRules(spec),
  agents: {
    [ORK_AGENT]: {
      mode: "primary",
      ...(spec.maxTurns === undefined ? {} : { steps: spec.maxTurns }),
    },
  },
});
