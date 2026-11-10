# Command Code

_Part of [Architecture](../architecture.md)._

Status: **Built and proven** on a real session (2026-11-10,
[below](#measured-on-the-gate-run)): the `command-code` descriptor
(`proven: true`), its fake tool, the `lease` MCP wiring and the adapter
([command-code.ts](../../packages/runtime/src/adapters/command-code.ts)) are
built, and the contract suite passes on the fake. Measured on Command Code
1.88.5 from `cmd --help`, `cmd mcp … --help`, `cmd mcp add/get/remove` run under
a throwaway `HOME` (no model session), the headless docs
(commandcode.ai/docs/core-concepts/headless) and the installed CLI's source.

- **Headless flags:** `cmd -p <brief>` (`--print`) with `--output-format json`;
  `-m, --model`; `--effort`; `--max-turns <n>` (default 100);
  `-r, --resume <id>` (a bare `--resume` errors in `-p` mode); `--fork-session`
  with `--resume`; `--permission-mode default|plan|accept-edits|yolo|dont-ask`;
  `--yolo`; `--tools-all` and `--tools-enable <names>` (tools a headless run
  withholds); `--add-dir`; `--skill`, `--no-skills`; `--safe-mode` (built-in
  mods only); `--skip-onboarding`; `--no-auto-update`. No flag names an MCP
  config, a report schema or a permission callback.
- **Output:** one NDJSON line per frame, `{"type":"event","event":{…}}`, then
  one result line. Frames read from the CLI's source: `turn_start {turnNumber}`,
  `text_delta {delta}`, `tool_queued {toolCallId, toolName, input}`,
  `tool_running {toolCallId, toolName, description}`,
  `tool_completed {toolCallId, toolName, result}` (content blocks),
  `tool_errored {toolCallId, toolName, error}`,
  `tool_hook_blocked {toolCallId, toolName, hookOutput}`,
  `model_request_end {model, usage, stopReason}` and `run_end {result}`; unknown
  frame types are to be ignored (the docs' rule). The result line:
  `{"type":"result","subtype":"success"|"error"|"max_turns","sessionId","stopReason","usage","durationMs","finalText","error"?}`,
  with `usage` as
  `{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}` and no cost;
  `sessionId` and `stopReason` may be missing on an error. An MCP tool's
  `toolName` is `mcp__<server>__<tool>`, as the fake assumed.
- **Exit codes:** 0 success, 1 error, 3 not signed in, 4 permission denied, 5
  rate limited, 6 network, 7 server error, 8 out of turns (`error_max_turns`), 9
  no response, 10 out of credits, 130 interrupted. Ork reads them as end kinds
  ([how a session ends](../runtime/session-ends.md#who-maps-what)): 3 and 4
  `auth`, 5 `rate_limited`, 6, 7 and 9 `provider_unavailable`, 8 `turn_limit`,
  10 `out_of_credits`, 130 `interrupted`; any other failure goes through the
  shared provider classifier.
- **MCP scopes:** user (`~/.commandcode/mcp.json`), project (`.mcp.json` in the
  checkout) and local (`~/.commandcode/projects/<slug>/mcp.json`, private to the
  machine), local winning. `<slug>` is the checkout's real path with every
  character but letters and digits made `-`, the leading one dropped
  (`/private/tmp/a b.c_d` → `private-tmp-a-b-c-d`), so two paths can share one.
  `cmd mcp add --transport http --scope local ork <url> --header "Authorization: Bearer <token>"`
  writes the entry (file mode 0600) and silently replaces one of the same name;
  `cmd mcp remove --scope local ork` removes only it (exit 1, "not found", when
  absent); `cmd mcp get ork` prints its `Scope:`, with the header masked.
- **The `lease` wiring** ([lease.ts](../../packages/runtime/src/lease.ts)): a
  session's Ork endpoint is that `ork` entry in its checkout's local scope,
  added before the session and removed after it, the user's other entries left
  as they were. One session per checkout: a lease record in the project's runs
  folder (`.ork/runs/.leases/<slug>.json`: the lease id, checkout, process id
  and entry file), taken atomically (a hard link), is the lock. A second session
  in the same checkout polls until it is free and says so once, as a
  `session.waiting` runtime event ("waiting for `<checkout>`: Command Code runs
  one session per checkout"), which logs and the UI show and replay ignores; an
  interrupt ends the wait. A record whose process is gone is stale: the next
  Command Code session's start and `ork doctor`
  ([doctor](../cli/worktrees-agents-context-and-doctor.md#doctor)) remove its
  `ork` entry (with `cmd mcp remove`, or by editing the entry file when the
  checkout is gone) and the record. A removal that fails after a session keeps
  the record, marked stale, for the next sweep. Ork never replaces an `ork`
  entry in local scope it did not lease: the session fails and says how to
  remove it. The bearer token is only in `cmd mcp add`'s arguments and the
  user's 0600 entry file; an error is masked before it is shown.
- **The adapter:** a session runs
  `cmd -p <query> --output-format json --permission-mode yolo --dangerously-skip-permissions --skip-onboarding --no-auto-update`,
  plus `--model`, `--effort`, `--max-turns`, `--resume <id>` and
  `--fork-session` from the spec, and `--mod <file>` from the wiring. The query
  is Ork's instructions, a blank line and the brief on a session's first leg
  (Command Code has no flag that adds to its system prompt); a resumed leg sends
  the message alone. Command Code takes no message mid-turn, so a message waits
  for the next leg, which resumes the session with it. The decoder keeps one
  leg's state: `run_start {sessionId}` is the session's start, `turn_start`
  frames count its turns, `message_end {content}` text blocks are its text,
  `tool_queued` a call, `tool_completed` a result, and `tool_errored`,
  `tool_denied` and `tool_hook_blocked` a refused one. Command Code's tool names
  are shown as Ork's (`shell` as `Bash`, `read_file` as `Read`, `edit_file` as
  `Edit`, `write_file` as `Write`, `web_fetch` as `WebFetch`). The result line's
  `success`, `max_turns` (exit code 8) and `error` become `success`,
  `error_max_turns` and `error_during_execution`; usage is tokens, never
  dollars. Its report comes through Ork's `report` tool.
- **Deny by default:** Command Code reads permission rules only from settings
  files (`~/.commandcode/settings.json`, and `.commandcode/settings.json` and
  `settings.local.json` in the checkout; no flag or variable), and in `dont-ask`
  mode it still runs read-only shell commands and the user's own allow rules. In
  `-p` mode it also adds its own gate refusing edits, writes and shell, which
  only `--dangerously-skip-permissions` (`--yolo`) lifts;
  `--permission-mode yolo` alone does not. So Ork passes both and loads a mod
  written for the session
  ([command-code-mod.ts](../../packages/runtime/src/adapters/command-code-mod.ts),
  maintainer's choice): a JavaScript file in a fresh 0700 folder under the
  system's temp folder (0600, no secret, removed after the session) whose
  `beforeToolCall` hook blocks every call the node did not allow, so the frame
  is `tool_hook_blocked`. The node's rules are read in Claude Code's words:
  `Bash(git:*)` and `Bash(git status)` match shell commands, `Read` covers
  `Glob` and `Grep`, `Edit` covers `Write`, `mcp__<server>` a server's tools; a
  deny wins, `only` limits the rest, and Ork's own `mcp__ork__*` tools always go
  through, and so does Command Code's own tool loader (`search_tools`,
  `tool_search`), which a session needs to load the schema of Ork's `report`.
  Reads (`read_file`, `read_multiple_files`, `read_directory`, `glob`, `grep`)
  need no rule when every path in their input is inside the worktree, as with
  Claude Code; one reaching outside it needs one. A specifier Ork does not read
  (a path, a domain) never allows a call and always denies one. An `acceptEdits`
  node is allowed `Edit`.
- **Context:** Command Code reads `AGENTS.md`, `.commandcode/skills` and
  `.commandcode/agents` in the checkout. **Limits:** the machine's own Command
  Code setup (user skills, memory, installed mods, user and project MCP servers)
  still loads, since `--safe-mode` refuses `--mod`; the mod blocks calls to MCP
  servers the node did not allow, but they still start. A node's own
  `mcpServers` are not given to Command Code. A user setting that disables
  bypass mode would make the session prompt. There is no hold hook, so a paused
  node's session runs to its end. `run_start` names no model, so a session's
  start shows none.
- **The ledger's place:** the runner is given the project's runs folder
  (`createRuntime(driver, env, runs)`, `RunnerOptions.runs`), and the lease
  wiring keeps its records there; a session with none fails before it starts.
  Stale leases are swept at each Command Code session's start and by
  `ork doctor`, not at a run's start.
- **Fake:**
  [fake-command.mjs](../../packages/runtime/test/fixtures/fake-command.mjs)
  keeps `mcp add/get/remove/list` per folder under `$HOME` and, in `-p` mode,
  reaches Ork through its folder's `ork` entry, loads `--mod` as Command Code
  does and prints the shapes above, with fake-claude's `FAKE_SCENARIO` cases
  plus `report-tool` and `max-turns` (exit 8).

## Measured on the gate run

On 2026-11-10, Command Code 1.88.5 and Claude Haiku 5.5, two nodes, capped by
`maxTurns` (Command Code reports no price):

- The mod API works in `-p` mode: `beforeToolCall` blocks a call, and the model
  sees the mod's words.
- Before the fixes above, every shell call was refused by Command Code's own
  `-p` gate, every read in the worktree by Ork's mod, and `search_tools` too, so
  a session could not load the `report` tool. With them, `shell` runs in the
  worktree, a read outside it and a command the node denied are refused, and the
  report a session hands in ends it.
- `run_start` and `message_end` are in the printed frames.
- An untrusted folder does not prompt in `-p` mode.
- `--max-turns` holds: the session ends `max_turns`, read as `error_max_turns`.
