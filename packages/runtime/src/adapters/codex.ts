/**
 * @file The `codex` adapter (RFC-024): the user's own `codex exec --json`
 *   (0.169.0), logged in by the user, one process per leg in the node's
 *   worktree. A later message or answer waits for the leg's end and resumes the
 *   session (`exec resume <id> <message>`); a question fork is `exec fork <id>
 *   <message>`. Every leg passes the same keys by `-c` (TOML values): the
 *   sandbox (the outer wall, never wider than `workspace-write`, network off),
 *   Ork's MCP server with its token in the leg's environment only, and the
 *   session's `PreToolUse` hook (`codex-hook.ts`), which holds the node's rules
 *   and runs only with `--dangerously-bypass-hook-trust`. So that no other hook
 *   runs untrusted beside it, a user or system `hooks.json` refuses the session
 *   before anything starts (Ork checks that the file exists, never reads it).
 *   The user's config, rules, plugins and apps stay out; Ork's instructions go
 *   in `developer_instructions` on a session's first leg (a resumed or forked
 *   leg keeps its session's). Never `--skip-git-repo-check`, `--trust`,
 *   `--approve-for-me`, `--ephemeral`, a profile, `danger-full-access` or the
 *   full bypass.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { RuntimeEvent, SessionSpec, ToolRules } from "@krapht/ork-core";

import type { CliAdapter, LegDecoder, McpWiring } from "../adapter.ts";
import { driverFailure } from "../session-end.ts";
import { toolRuleSet } from "../tools/tool-rules-source.ts";
import { ORK_TOOL_TIMEOUT_MS } from "./claude-code-flags.ts";
import { CODEX_TOOLS, codexDecoder, codexUsage, NONE } from "./codex-events.ts";
import { type HookFile, tomlValue, writeHook } from "./codex-hook.ts";

/**
 * The leg's variable holding Ork's bearer token; Codex keeps `*TOKEN*` out of
 * shells.
 */
export const CODEX_TOKEN_VAR = "ORK_CODEX_MCP_TOKEN";

/** The system's hooks file, which Codex would run untrusted beside Ork's. */
export const CODEX_SYSTEM_HOOKS = "/etc/codex/hooks.json";

/** One `-c key=value`, the value in TOML. */
const config = (key: string, value: unknown): string[] => [
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
export const codexSandbox = (spec: SessionSpec): string => {
  if (spec.permissionMode === "plan") return "read-only";
  const { allow, deny, only } = toolRuleSet(spec);
  if (deniesWriting(deny)) return "read-only";
  // `only` caps allow and yolo alike: a node held to reads never acts.
  if (only !== undefined && !acting(only)) return "read-only";
  return acting(allow) || spec.yolo === true ? "workspace-write" : "read-only";
};

/** Ork's efforts in Codex's words: it has no `max`, `xhigh` is its highest. */
const effortOf = (effort: NonNullable<SessionSpec["effort"]>): string =>
  effort === "max" ? "xhigh" : effort;

/**
 * The `codex exec` arguments of one leg, the message last. Ork's MCP server and
 * the hook come after it, from the wiring (Codex reads options after the
 * message too).
 */
export const codexArgs = (spec: SessionSpec): string[] => [
  "exec",
  ...(spec.resume === undefined
    ? []
    : [spec.fork === true ? "fork" : "resume", spec.resume]),
  "--json",
  "--ignore-user-config",
  "--ignore-rules",
  "--dangerously-bypass-hook-trust",
  "--disable",
  "plugins",
  "--disable",
  "apps",
  "--disable",
  "remote_plugin",
  ...config("sandbox_mode", codexSandbox(spec)),
  ...(spec.model === undefined ? [] : ["-m", spec.model]),
  ...(spec.effort === undefined
    ? []
    : config("model_reasoning_effort", effortOf(spec.effort))),
  // A resumed or forked leg keeps its session's instructions (RFC-024 spike).
  ...(spec.resume === undefined && spec.systemAppend !== ""
    ? config("developer_instructions", spec.systemAppend)
    : []),
  // A message starting with `-` would read as a flag.
  spec.prompt.startsWith("-") ? ` ${spec.prompt}` : spec.prompt,
];

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

/** Ork's MCP server and the hook, as `-c` keys; the token in the env only. */
const wiring = (system: string, root: string | undefined): McpWiring => ({
  kind: "flag",
  wire: (spec, endpoint, hooks) => {
    const found = userHooks(hooks.env ?? process.env, system);
    if (found.length > 0) {
      throw new Error(
        `${found.join(" and ")} exists: Ork runs its own Codex hook with --dangerously-bypass-hook-trust, which would run that file's hooks untrusted too. Move it away to run this node on codex.`,
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

/** What a leg that ran tools its hook never saw ends with. */
export const HOOK_DID_NOT_RUN =
  "Codex ran tool calls without Ork's hook, so the node's tool rules were not applied; the node is stopped. Check that nothing else sets Codex's hooks.";

/**
 * A leg's decoder with the canary: once a tool call finished while the hook's
 * calls file did not grow in this leg, the session ends with a driver error and
 * the line asks the runner to kill the leg (`kill`), so Codex runs no further
 * unguarded; nothing is decoded after it. A call the hook refused leaves no
 * line (RFC-024 spike), so each refusal in the calls file becomes a refused
 * tool call at the next line or the leg's exit, marked `fault: "refused"`.
 */
const guarded = (spec: SessionSpec): LegDecoder => {
  const hook = HOOKS.get(spec.tools);
  const before = hook?.count().calls ?? 0;
  let surfaced = hook?.refusals().length ?? 0;
  const decoder = codexDecoder(spec);
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
    decode: line => {
      // Ended: nothing Codex prints after the canary is the session's.
      if (tripped) return { events: [] };
      const decoded = decoder.decode(line);
      for (const event of decoded.events) {
        if (event.type === "session.started") sessionId = event.sessionId;
      }
      // The hook ran before this line was printed.
      const events = [...refused(), ...decoded.events];
      const ran = (hook?.count().calls ?? 0) > before;
      if (!decoder.toolsRan() || ran) return { ...decoded, events };
      tripped = true;
      return {
        events: [
          ...events,
          driverFailure(
            HOOK_DID_NOT_RUN,
            "driver_crashed",
            { facts: {} },
            {
              usage: NONE,
              sessionId,
            },
          ),
        ],
        kill: true,
      };
    },
    exit: code => (tripped ? [] : [...refused(), ...decoder.exit(code)]),
  };
};

export type CodexOptions = {
  /** The system's hooks file to refuse on (tests). */
  systemHooks?: string;
  /** Where the sessions' private folders go; the system's temporary folder. */
  secretRoot?: string;
};

/** `codex`, as the session runner's strategies. */
export const createCodexAdapter = (options: CodexOptions = {}): CliAdapter => ({
  driver: "codex",
  command: { bin: "codex", args: codexArgs },
  decode: line => codexDecoder({ cwd: "" }).decode(line),
  // No result line: a leg's decoder keeps what the session's end needs.
  legDecoder: guarded,
  mcp: wiring(options.systemHooks ?? CODEX_SYSTEM_HOOKS, options.secretRoot),
  permissions: { kind: "rules", denyByDefault: true },
  usage: codexUsage,
  context: {
    instructions: ["AGENTS.md"],
    skills: ".agents/skills",
    agents: ".codex/agents",
    env: () => ({}),
  },
});

export const codexAdapter: CliAdapter = createCodexAdapter();
