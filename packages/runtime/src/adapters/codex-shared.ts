/**
 * @file What the Codex adapters share (`codex exec` and `codex app-server`):
 *   the `-c key=value` helper, the sandbox a node's rules allow, Ork's MCP
 *   server and PreToolUse hook as `-c` keys with the token in the environment
 *   only, the refusal of a user or system `hooks.json`, and the message of a
 *   leg that ran tools its hook never saw. Nothing here starts a process or
 *   reads a frame.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { RuntimeEvent, SessionSpec, ToolRules } from "@krapht/ork-core";

import type { McpWiring } from "../adapter.ts";
import { driverFailure } from "../session-end.ts";
import { toolRuleSet } from "../tools/tool-rules-source.ts";
import { ORK_TOOL_TIMEOUT_MS } from "./claude-code-flags.ts";
import { CODEX_TOOLS, NONE } from "./codex-events.ts";
import { type HookFile, tomlValue, writeHook } from "./codex-hook.ts";

/**
 * The leg's variable holding Ork's bearer token; Codex keeps `*TOKEN*` out of
 * shells.
 */
export const CODEX_TOKEN_VAR = "ORK_CODEX_MCP_TOKEN";

/** The system's hooks file, which Codex would run untrusted beside Ork's. */
export const CODEX_SYSTEM_HOOKS = "/etc/codex/hooks.json";

/** What a leg that ran tools its hook never saw ends with. */
export const HOOK_DID_NOT_RUN =
  "Codex ran tool calls without Ork's hook, so the node's tool rules were not applied; the node is stopped. Check that nothing else sets Codex's hooks.";

/** One `-c key=value`, the value in TOML. */
export const config = (key: string, value: unknown): string[] => [
  "-c",
  `${key}=${tomlValue(value)}`,
];

/** The rule words that let a node change files: an edit or a shell command. */
const ACTING = new Set(["bash", "edit", "write"]);

/** Whether any of `rules` lets a node edit or run a shell command. */
const acting = (rules: readonly string[]): boolean =>
  rules.some(rule =>
    ACTING.has(rule.split("(")[0]?.trim().toLowerCase() ?? ""),
  );

/** The bare rules that, denied together, deny a node all writing. */
const WRITING = ["edit", "write"];

/**
 * Whether `deny` refuses writing outright: a bare `Edit` and a bare `Write` (no
 * path in parentheses), as a `readonly` node's isolation denies them.
 */
const deniesWriting = (deny: readonly string[]): boolean =>
  WRITING.every(tool => deny.some(rule => rule.trim().toLowerCase() === tool));

/**
 * The sandbox of a leg: `read-only` in plan mode, for a node denied writing
 * outright (whatever its allows or yolo say: a readonly node's `git status`
 * allow is a shell rule) and for a node whose rules allow no edit and no shell;
 * otherwise `workspace-write`, yolo included.
 */
export const codexSandbox = (
  spec: SessionSpec,
): "read-only" | "workspace-write" => {
  if (spec.permissionMode === "plan") return "read-only";
  const { allow, deny, only } = toolRuleSet(spec);
  if (deniesWriting(deny)) return "read-only";
  // `only` caps allow and yolo alike: a node held to reads never acts.
  if (only !== undefined && !acting(only)) return "read-only";
  return acting(allow) || spec.yolo === true ? "workspace-write" : "read-only";
};

/** Ork's efforts in Codex's words: it has no `max`, `xhigh` is its highest. */
export const effortOf = (effort: NonNullable<SessionSpec["effort"]>): string =>
  effort === "max" ? "xhigh" : effort;

/** The user's and the system's hooks files that exist. */
const userHooks = (
  env: Readonly<Record<string, string | undefined>>,
  system: string,
): string[] => {
  const set = env["CODEX_HOME"];
  // An empty CODEX_HOME is unset, as Codex reads it.
  const home =
    set === undefined || set === ""
      ? path.join(env["HOME"] ?? homedir(), ".codex")
      : set;
  return [path.join(home, "hooks.json"), system].filter(file =>
    existsSync(file),
  );
};

/**
 * Each session's hook, by its node's tool rules object: every leg's spec is a
 * copy of the session's, so it shares that object, and the leg's decoder finds
 * the hook without a change to `CliAdapter`. shortcut: two sessions started at
 * once from one tools object would share an entry (the later wins); pass the
 * wiring to `legDecoder` if that ever happens.
 */
const HOOKS = new WeakMap<ToolRules, HookFile>();

/** The hook `codexWiring` wrote for `spec`'s session, if it is still wired. */
export const codexHook = (spec: SessionSpec): HookFile | undefined =>
  HOOKS.get(spec.tools);

/** One leg's hook canary, as {@link hookCanary} makes it. */
export type HookCanary = {
  /** The leg has ended at the canary: nothing it reads after is the session's. */
  tripped: () => boolean;
  /** Each refusal the hook wrote since the last look, as a refused tool call. */
  refused: () => RuntimeEvent[];
  /**
   * A decoded line's or frame's events, with the refusals before them; once a
   * tool call finished (`toolsRan`) while the hook's calls file did not grow in
   * this leg, the leg trips and its end (a driver error) replaces any end among
   * them.
   */
  check: (events: RuntimeEvent[], toolsRan: boolean) => RuntimeEvent[];
};

/**
 * The canary of one leg of either Codex adapter. A call the hook refused leaves
 * no line (RFC-024 spike), so each refusal in the calls file becomes a refused
 * tool call, marked `fault: "refused"`; the hook runs before Codex reports the
 * call, so a finished call with no growth in the calls file ran without it.
 */
export const hookCanary = (spec: SessionSpec): HookCanary => {
  const hook = codexHook(spec);
  const before = hook?.count().calls ?? 0;
  let surfaced = hook?.refusals().length ?? 0;
  let sessionId = spec.resume ?? "";
  let tripped = false;
  const refused = (): RuntimeEvent[] => {
    const fresh = hook?.refusals().slice(surfaced) ?? [];
    return fresh.flatMap(tool => {
      surfaced += 1;
      const id = `hook-refused-${String(surfaced)}`;
      return [
        {
          type: "tool.called",
          id,
          name: CODEX_TOOLS[tool] ?? tool,
          input: {},
        },
        { type: "tool.result", id, isError: true, fault: "refused" },
      ];
    });
  };
  return {
    tripped: () => tripped,
    refused,
    check: (decoded, toolsRan) => {
      for (const event of decoded) {
        if (event.type === "session.started") sessionId = event.sessionId;
      }
      const events = [...refused(), ...decoded];
      const ran = (hook?.count().calls ?? 0) > before;
      if (!toolsRan || ran) return events;
      tripped = true;
      return [
        ...events.filter(event => event.type !== "session.finished"),
        driverFailure(
          HOOK_DID_NOT_RUN,
          "driver_crashed",
          { facts: {} },
          { usage: NONE, sessionId },
        ),
      ];
    },
  };
};

/**
 * Ork's MCP server and the hook, as `-c` keys; the token in the env only. A
 * user or system `hooks.json` refuses the node before anything starts. The
 * message names how each driver makes the inline hook run
 * (`--dangerously-bypass-hook-trust` on `codex exec`, the `bypass_hook_trust`
 * thread setting on `codex app-server`); whoever takes this for another command
 * must carry the hook there (and say so here) or fail the node closed.
 */
export const codexWiring = (
  system: string,
  root: string | undefined,
): McpWiring => ({
  kind: "flag",
  wire: (spec, endpoint, hooks) => {
    const found = userHooks(hooks.env ?? process.env, system);
    if (found.length > 0) {
      throw new Error(
        `${found.join(" and ")} exists: Ork runs its own Codex hook with its trust bypassed (--dangerously-bypass-hook-trust on codex, a bypass_hook_trust setting on codex-app-server), which would run that file's hooks untrusted too. Move it away to run this node on a Codex driver.`,
      );
    }
    const hook = writeHook(spec, root);
    HOOKS.set(spec.tools, hook);
    return Promise.resolve({
      args: [
        ...config("mcp_servers.ork.url", endpoint.url),
        ...config("mcp_servers.ork.bearer_token_env_var", CODEX_TOKEN_VAR),
        // Codex hands its environment to the agent's shell; keep the token out.
        ...config("shell_environment_policy.exclude", [CODEX_TOKEN_VAR]),
        ...config(
          "mcp_servers.ork.tool_timeout_sec",
          ORK_TOOL_TIMEOUT_MS / 1000,
        ),
        ...config("mcp_servers.ork.required", true),
        ...config("mcp_servers.ork.default_tools_approval_mode", "approve"),
        // Already a TOML value.
        "-c",
        `hooks.PreToolUse=${hook.config}`,
      ],
      env: { [CODEX_TOKEN_VAR]: endpoint.token },
      release: () => {
        if (HOOKS.get(spec.tools) === hook) HOOKS.delete(spec.tools);
        hook.remove();
        return Promise.resolve();
      },
    });
  },
});
