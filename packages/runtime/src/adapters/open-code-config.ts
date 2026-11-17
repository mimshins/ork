/**
 * @file The `open-code` adapter's session config (RFC-014, open questions 1 and
 *   3): Ork's MCP server with Code Mode off, so its tools reach the model as
 *   `ork_<tool>`; the node's MCP servers (none named `ork` or `ork_<x>`, whose
 *   tools would pass for Ork's); a dedicated `ork` agent carrying the turn cap;
 *   and the full permission rule set, written every session because OpenCode
 *   runs a shell call when no rule says otherwise. The rules deny everything
 *   first, then open what the node allowed (last match wins); a yolo run (`ork
 *   run --yolo`) allows everything first instead, so only the denies (and
 *   `only`) refuse.
 */

import path from "node:path";

import type { SessionSpec } from "@krapht/ork-core";

import type { OrkEndpoint } from "../adapter.ts";
import { ORK_TOOLS } from "../tools/registry.ts";
import { SHELL_READ_COMMANDS } from "../tools/shell-reads.ts";
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

/**
 * Actions whose resource is a path. OpenCode matches it relative to the
 * worktree (an absolute path inside it too), `*` across folders, and asks
 * `external_directory`, denied first, for any path outside it.
 */
const PATH_ACTIONS = new Set(["read", "edit"]);

/** A rule's path as OpenCode matches it: relative to the worktree. */
const pathResource = (spec: string, cwd: string): string => {
  const relative = path.isAbsolute(spec) ? path.relative(cwd, spec) : spec;
  return relative.replace(/^\.\//u, "") || "*";
};

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
          ? pathResource(spec, cwd)
          : spec;
    return { action, resource, effect };
  }
  return { action, resource: "*", effect };
};

const rulesOf = (
  rules: readonly string[],
  effect: Rule["effect"],
  cwd: string,
): Rule[] => rules.flatMap(rule => ruleOf(rule, effect, cwd) ?? []);

/** An action allowed anywhere in the worktree; outside it is denied. */
const worktree = (action: string): Rule => ({
  action,
  resource: "*",
  effect: "allow",
});

/**
 * A yolo session's refusals of the built-in tools its `only` leaves out, as
 * `--tools` would; none without `only`.
 */
const outsideOnly = (only: ReadonlySet<string> | undefined): Rule[] =>
  only === undefined
    ? []
    : [...BUILT_IN]
        .filter(action => !only.has(action))
        .map((action): Rule => ({ action, resource: "*", effect: "deny" }));

/** A node that cannot edit reads text through `extract`; images and PDFs stay. */
const textReadRules: Rule[] = [
  { action: "read", resource: "*", effect: "deny" },
  ...["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "pdf"].map(
    (ext): Rule => ({ action: "read", resource: `*.${ext}`, effect: "allow" }),
  ),
];

/** A shell line that starts by reading files, refused (`extract` reads it). */
const shellReadRules: Rule[] = SHELL_READ_COMMANDS.flatMap(command => [
  { action: "shell", resource: command, effect: "deny" },
  { action: "shell", resource: `${command} *`, effect: "deny" },
]);

/**
 * The session's rules, in order: deny everything (a yolo run: allow it, then
 * refuse the built-ins its `only` leaves out); read in the worktree (as Claude
 * Code reads without asking); edits there under `acceptEdits`; the node's
 * allows (only its `only` tools, if it names them); Ork's tools; then `.env`
 * reads, plan mode's edits and shell, shell reads (unless `reading: open`;
 * RFC-025), and the node's denies, refused.
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
  const allows = [
    worktree("read"),
    ...(spec.permissionMode === "acceptEdits" ? [worktree("edit")] : []),
    ...rulesOf(tools.allow, "allow", cwd),
  ].filter(rule => inOnly(rule));
  return [
    ...(spec.yolo === true
      ? [
          { action: "*", resource: "*", effect: "allow" } satisfies Rule,
          ...outsideOnly(only),
        ]
      : [{ action: "*", resource: "*", effect: "deny" } satisfies Rule]),
    ...allows,
    // Exact names: `ork_*` would also open a repo server named `ork_<x>`.
    ...ORK_TOOLS.map((tool): Rule => ({
      action: mcpAction(ORK_SERVER, tool.name),
      resource: "*",
      effect: "allow",
    })),
    { action: "read", resource: "*.env", effect: "deny" },
    ...(spec.permissionMode === "plan"
      ? (["edit", "shell"] as const).map((action): Rule => ({
          action,
          resource: "*",
          effect: "deny",
        }))
      : []),
    ...(spec.reading === "open" ? [] : shellReadRules),
    ...(spec.reading === "extract-only" ? textReadRules : []),
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

/**
 * The node's servers, refusing one named `ork` or `ork_<x>`: OpenCode names a
 * tool `<server>_<tool>`, so its tools could pass for Ork's `ork_<tool>`. The
 * error names the server only, never its env or headers.
 */
const nodeServers = (spec: SessionSpec): [string, Record<string, unknown>][] =>
  Object.entries(spec.mcpServers ?? {}).map(([name, entry]) => {
    if (name === ORK_SERVER || name.startsWith(`${ORK_SERVER}_`)) {
      throw new Error(
        `the MCP server \`${name}\` can't load under OpenCode: the name \`${ORK_SERVER}\` and the prefix \`${ORK_SERVER}_\` are reserved for Ork's tools; rename it in .mcp.json`,
      );
    }
    return [name, serverOf(entry)];
  });

/** The whole config file for one session. */
export const sessionConfig = (
  spec: SessionSpec,
  endpoint: OrkEndpoint,
  instructions: string,
): Record<string, unknown> => ({
  instructions: [instructions],
  mcp: {
    servers: {
      ...Object.fromEntries(nodeServers(spec)),
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
