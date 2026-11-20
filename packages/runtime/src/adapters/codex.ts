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

import type { SessionSpec } from "@krapht/ork-core";

import type { CliAdapter, LegDecoder } from "../adapter.ts";
import { codexDecoder, codexUsage } from "./codex-events.ts";
import {
  CODEX_SYSTEM_HOOKS,
  CODEX_TOKEN_VAR,
  codexSandbox,
  codexWiring,
  config,
  effortOf,
  HOOK_DID_NOT_RUN,
  hookCanary,
} from "./codex-shared.ts";

// Public through the package entry point (`export *` in `index.ts`).
export { CODEX_SYSTEM_HOOKS, CODEX_TOKEN_VAR, codexSandbox, HOOK_DID_NOT_RUN };

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

/**
 * A leg's decoder with the canary: once a tool call finished while the hook's
 * calls file did not grow in this leg, the session ends with a driver error and
 * the line asks the runner to kill the leg (`kill`), so Codex runs no further
 * unguarded; nothing is decoded after it. A call the hook refused leaves no
 * line (RFC-024 spike), so each refusal in the calls file becomes a refused
 * tool call at the next line or the leg's exit, marked `fault: "refused"`.
 */
const guarded = (spec: SessionSpec): LegDecoder => {
  const canary = hookCanary(spec);
  const decoder = codexDecoder(spec);
  return {
    decode: line => {
      // Ended: nothing Codex prints after the canary is the session's.
      if (canary.tripped()) return { events: [] };
      const decoded = decoder.decode(line);
      // The hook ran before this line was printed.
      const events = canary.check(decoded.events, decoder.toolsRan());
      return canary.tripped() ? { events, kill: true } : { ...decoded, events };
    },
    exit: code =>
      canary.tripped() ? [] : [...canary.refused(), ...decoder.exit(code)],
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
  mcp: codexWiring(
    options.systemHooks ?? CODEX_SYSTEM_HOOKS,
    options.secretRoot,
  ),
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
