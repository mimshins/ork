/**
 * @file The `codex-app-server` adapter (RFC-027, option A): the user's own
 *   `codex app-server` (JSON-RPC 2.0 over stdio, codex-cli 0.169.0), logged in
 *   by the user, one long-lived process per leg in the node's worktree, driven
 *   through the `codex-rpc.ts` codec. A message is a `turn/steer`, an interrupt
 *   a `turn/interrupt`, and a command or file change Codex asks about is
 *   approved through Ork's human channel; a question fork is `thread/fork`.
 *   Unproven: no model was called while it was built. The rules bind as on
 *   `codex`: the sandbox from the node's rules (in `thread/start` and as `-c
 *   sandbox_mode`, never `danger-full-access`), Ork's MCP server with its token
 *   in the process environment only, and the session's `PreToolUse` hook as `-c
 *   hooks.PreToolUse`. `app-server` has none of `exec`'s
 *   `--ignore-user-config`, `--ignore-rules` or
 *   `--dangerously-bypass-hook-trust`, so:
 *
 *   - the hook's trust is bypassed by `config: { bypass_hook_trust: true }` on
 *     every thread request (**guessed** from the binary's strings, not run): if
 *     the guess is wrong, Codex refuses the thread (the leg fails) or the hook
 *     never runs and the canary ends the leg at the first finished tool call
 *     (`HOOK_DID_NOT_RUN`);
 *   - a user or system `hooks.json` refuses the session before it starts, as on
 *     `codex`, and the codec's fence (`hooks/list` after `initialize`) refuses
 *     the leg before any thread when Codex loads a hook Ork did not pass (the
 *     user's `config.toml` `[hooks]`, a project's, the system's) or does not
 *     load Ork's;
 *   - the user's `config.toml` (its MCP servers, profile) and execpolicy `.rules`
 *     still load: a recorded limit, with Ork's hook still seeing every call. No
 *     `hold` hook: a paused node runs on to its turn's end, as on `codex`.
 *     Never `--dangerously-bypass-approvals-and-sandbox`, `danger-full-access`
 *     or an accept-for-session answer.
 */

import type { SessionSpec } from "@krapht/ork-core";

import type { CliAdapter, Codec } from "../adapter.ts";
import { codexDecoder, codexUsage } from "./codex-events.ts";
import { type CodexRpcCodec, codexRpcCodec } from "./codex-rpc.ts";
import {
  CODEX_SYSTEM_HOOKS,
  codexSandbox,
  codexWiring,
  config,
  effortOf,
  hookCanary,
} from "./codex-shared.ts";

/**
 * What every thread request carries in `config`: the trust of Ork's own hook,
 * which `app-server` has no flag for. Guessed, see the file's header.
 */
export const CODEX_APP_SERVER_CONFIG = { bypass_hook_trust: true };

/**
 * The `codex app-server` arguments of one leg; the wiring's `-c` keys follow.
 * The brief is no argument: the codec sends it as `turn/start`. The sandbox and
 * approval policy go in `thread/start` too; the keys hold them if a thread
 * request's field were ignored.
 */
export const codexAppServerArgs = (spec: SessionSpec): string[] => [
  "app-server",
  "--disable",
  "plugins",
  "--disable",
  "apps",
  "--disable",
  "remote_plugin",
  ...config("sandbox_mode", codexSandbox(spec)),
  ...config("approval_policy", "on-request"),
];

/**
 * A leg's codec with the hook's canary: once a tool call finished while the
 * hook's calls file did not grow in this leg, the leg ends with a driver error
 * and the client closes the process; nothing is decoded after it, so no ask
 * reaches Ork either.
 */
export const guardedCodec = (
  spec: SessionSpec,
  codec: CodexRpcCodec,
): Codec => {
  const canary = hookCanary(spec);
  return {
    ...codec,
    decode: frame => {
      if (canary.tripped()) return { events: [] };
      const decoded = codec.decode(frame);
      const events = canary.check(decoded.events, codec.toolsRan());
      return canary.tripped() ? { events } : { ...decoded, events };
    },
  };
};

/** A leg's codec: the node's sandbox and effort, the hook's trust and fence. */
const legCodec = (spec: SessionSpec): Codec =>
  guardedCodec(
    spec,
    codexRpcCodec(spec, {
      sandbox: codexSandbox(spec),
      ...(spec.effort === undefined ? {} : { effort: effortOf(spec.effort) }),
      config: CODEX_APP_SERVER_CONFIG,
      fence: true,
    }),
  );

export type CodexAppServerOptions = {
  /** The system's hooks file to refuse on (tests). */
  systemHooks?: string;
  /** Where the sessions' private folders go; the system's temporary folder. */
  secretRoot?: string;
};

/** `codex-app-server`, as the session runner's strategies. */
export const createCodexAppServerAdapter = (
  options: CodexAppServerOptions = {},
): CliAdapter => ({
  driver: "codex-app-server",
  command: { bin: "codex", args: codexAppServerArgs },
  decode: line => codexDecoder({ cwd: "" }).decode(line),
  // Frames both ways; no `command.input`.
  protocol: legCodec,
  mcp: codexWiring(
    options.systemHooks ?? CODEX_SYSTEM_HOOKS,
    options.secretRoot,
  ),
  // Command and file-change approvals arrive as requests Ork answers.
  permissions: { kind: "callback", denyByDefault: true },
  usage: codexUsage,
  context: {
    instructions: ["AGENTS.md"],
    skills: ".agents/skills",
    agents: ".codex/agents",
    env: () => ({}),
  },
});

export const codexAppServerAdapter: CliAdapter = createCodexAppServerAdapter();
