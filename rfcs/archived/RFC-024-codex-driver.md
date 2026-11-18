# RFC-024 — The Codex driver: OpenAI's `codex` CLI as the fourth driver

- **Status:** Implemented
- **Date:** 2026-11-17
- **Supersedes:** —
- **Superseded by:** —

## Contents

- [Context](#context)
- [Options](#options): 1 how a session runs, 2 permissions, 3 a clean session, 4
  structured output, 5 usage and cost, 6 models
- [Decision](#decision)
- [Consequences](#consequences)
- [Open questions](#open-questions): what the spike must confirm
- [What the spike found](#what-the-spike-found): the answers, 2026-11-18

## Context

Ork runs agents only through each tool's own CLI
([ADR-076](../../decisions/ADR-076-cli-drivers-only.md)): a driver is a
descriptor in [drivers.ts](../../packages/integrations/src/drivers.ts) plus an
adapter made of small strategies (command, decoder, MCP wiring, permissions,
usage, context) in [adapter.ts](../../packages/runtime/src/adapter.ts),
registered in [registry.ts](../../packages/runtime/src/registry.ts) and run by
one session runner
([session-runner.ts](../../packages/runtime/src/session-runner.ts)). Three
drivers exist: `claude-code`, `open-code` and `command-code`
([runtime spec](../../specs/runtime.md),
[which driver](../../specs/runtime/which-driver.md)). The request is a fourth:
OpenAI's Codex CLI (`codex`), which many users already have signed in (a ChatGPT
account or an API key), with its login kept in Codex's own `CODEX_HOME`, never
in Ork ([ADR-004](../../decisions/ADR-004-no-credentials.md)).

What a driver must give the runner is fixed by the existing adapters:

- a headless session in the node's folder, and its events decoded into
  `RuntimeEvent`s with the session id, the outcome and the usage;
- a follow-up turn on the same session (an answer, a message, `ork resume`,
  `ork chat`, a leader's question fork): `command.input` for a tool that takes
  lines on stdin mid-turn (`claude-code`), otherwise the next _leg_ resumes the
  session with the message (`open-code`, `command-code`);
- Ork's MCP tools (`ask_user`, `report`, `delegate`, `extract`, …) over HTTP
  with a per-session bearer token, which never goes on the command line
  ([secret-file.ts](../../packages/runtime/src/secret-file.ts),
  [claude-code-flags.ts](../../packages/runtime/src/adapters/claude-code-flags.ts));
- the node's `tools.allow`, `deny`, `only`, permission mode and `yolo` as the
  tool's own rules, deny by default where the tool cannot ask
  ([open-code spec](../../specs/runtime/open-code.md#permissions-deny-by-default),
  [command-code-mod.ts](../../packages/runtime/src/adapters/command-code-mod.ts));
- a model, usage and (where the tool reports it) cost, a clean session
  ([ADR-065](../../decisions/ADR-065-clean-claude-sessions.md),
  [what a session loads](../../specs/runtime/what-a-session-loads.md)), and a
  doctor check.

What `codex` 0.169.0 offers, read from `codex --help`, `codex exec --help`,
`codex exec resume --help`, `codex mcp add --help` and `codex features list` on
the maintainer's machine (signed in with a ChatGPT account); nothing here was
run against a model, so every behavior below is a claim to confirm in the spike
(see Open questions):

- `codex exec [PROMPT]` runs non-interactively (the prompt may come on stdin);
  `--json` prints JSONL events; `-o` writes the final message;
  `--output-schema <FILE>` takes a JSON Schema for the final response;
  `codex exec resume <id>` and `codex exec fork <id>` continue or fork a
  session; `--ephemeral` keeps no session files.
- `-m`, `-p` (reads `$CODEX_HOME/<name>.config.toml`), `-c key=value` (TOML
  override of any config value), `--ignore-user-config` (auth still from
  `CODEX_HOME`), `--ignore-rules` (execpolicy `.rules`), `--strict-config`.
- `-s read-only | workspace-write | danger-full-access`, `--add-dir`, `-C`,
  `--skip-git-repo-check`, `--approve-for-me` (an automatic reviewer answers
  approval requests), `--dangerously-bypass-approvals-and-sandbox`. `exec` has
  no flag that asks a person. `exec resume` lists none of `-s`, `-C` or
  `--add-dir`, but does list `--json`, `--ephemeral`, `--ignore-user-config`,
  `--ignore-rules`, `--output-schema` and `-m`.
- MCP: `codex mcp add <name> --url <URL> --bearer-token-env-var <VAR>` for a
  streamable HTTP server, which suggests `-c mcp_servers.<name>.url=…` and
  `.bearer_token_env_var=…` per session without touching the user's config.
- `hooks` (stable, on), `plugins` and `goals` (stable, on) and `memories`
  (stable, off by default) are features in `codex features list`;
  `--dangerously-bypass-hook-trust` and `--trust` name hook trust and project
  trust. `codex app-server` is `[experimental]`, with `generate-ts` and
  `generate-json-schema` for its protocol. `codex login status` and
  `codex doctor` exist. Codex reads `AGENTS.md` natively.

Not in scope: Codex Cloud, the desktop app, `codex review` as a node type,
`--worktree` (Ork manages worktrees itself).

The six decisions below are one design, taken together because each depends on
the first (a per-turn process fixes what permissions and messages can be); the
maintainer chose each in turn.

## Options

### 1. How a session runs

#### Option 1A — `codex exec --json` per leg, `exec resume` for follow-ups

- **Pros:** the shape of `open-code` and `command-code`: the brief goes in as
  stdin or an argument, a later message waits for the leg's end and
  `codex exec resume <id> <message>` continues it, with a `legDecoder` for the
  exit code; no new strategy in `CliAdapter` and no change in the session
  runner. Stable, documented CLI surface.
- **Cons:** no mid-turn message (`midTurnMessages: false`) and no approval Ork
  can answer (`permissionPrompt: false`); one process per turn, so a start-up
  cost on each leg; resume needs the session files (see decision 3).

#### Option 1B — `codex app-server`, JSON-RPC over stdio

- **Pros:** one long process per session, as `claude-code`'s stream-json input;
  mid-turn messages, approval requests Ork could answer, typed events.
- **Cons:** marked `[experimental]` in 0.169.0, its protocol generated per
  version; `CliAdapter` has only `command.input` (lines on stdin), so it needs a
  JSON-RPC client strategy or a second path in the runner; a protocol pinned to
  Codex versions Ork cannot control.

#### Option 1C — exec per leg now, app-server as its own later RFC

- **Pros:** the build of 1A, with the upgrade named; gaps recorded in
  [gaps](../../specs/gaps.md) so the review at the end of the roadmap sees them.
- **Cons:** the same limits as 1A until that RFC.

### 2. Permissions

#### Option 2A — Sandbox modes only; refuse what they cannot hold

- **Pros:** nothing to enforce beyond Codex's own sandbox; the simplest wall.
- **Cons:** a sandbox is coarse (read-only, workspace-write): `Bash(<prefix>)`
  allows, denies, path-scoped edits and MCP tool rules cannot be held, so
  `ork validate` would refuse most nodes with real rules, Ork's own build nodes
  among them.

#### Option 2B — Sandbox plus a per-session hook that enforces the rules

- **Pros:** the command-code precedent
  ([command-code-mod.ts](../../packages/runtime/src/adapters/command-code-mod.ts)):
  the node's rules, in Claude Code's words, checked per call and deny by
  default, with Ork's own tools always through; keeps `Bash(<prefix>)` rules; it
  can also carry the hold hook
  ([ADR-041](../../decisions/ADR-041-pause-continue-stop.md)).
- **Cons:** depends on facts not yet measured (hook coverage of shell,
  `apply_patch` and MCP calls in `exec`; loading by `-c`; hook trust); a hook
  that does not load must fail closed, not run unguarded.

#### Option 2C — Sandbox plus a per-session execpolicy `.rules` file

- **Pros:** native to Codex; denies become `forbidden` prefix rules.
- **Cons:** matches command prefixes only; cannot deny by default (a command no
  rule matches still runs in the sandbox, to confirm), cannot see edits or MCP
  calls; needs a private `CODEX_HOME` to inject a rules file without the user's,
  which decision 3 does not take.

### 3. A clean session

#### Option 3A — Flags and `-c` overrides; sessions persist in the user's `CODEX_HOME`

- **Pros:** `--ignore-user-config --ignore-rules` and every Ork setting as `-c`;
  the login is untouched; resume works from the files Codex keeps; least code.
- **Cons:** each Ork session lands in the user's Codex session list and state
  under `~/.codex`; that nothing else of the user's setup (plugins, skills,
  hooks, memories) leaks past `--ignore-user-config` is unconfirmed; no `-p`
  profile (it reads a file in the user's `CODEX_HOME`).

#### Option 3B — A private `CODEX_HOME` per run, with the login pointed at the user's

- **Pros:** full isolation: sessions, history, sqlite state and rules stay in
  Ork's folder.
- **Cons:** the login must enter it as a symlink to the user's `auth.json` (a
  copy would store a credential, against ADR-004), and whether Codex's token
  refresh keeps a symlink is unknown; a folder per run to create, find again for
  `ork chat` and clean up.

#### Option 3C — Flags, with `--ephemeral` when no later leg can happen

- **Pros:** no session files left behind on a session that ends in one leg.
- **Cons:** Ork cannot know that up front (a message, a deferred hold,
  `ork chat` and a question fork all resume); it narrows resume.

### 4. Structured output

#### Option 4A — Ork's `report` tool (`reportSchema: false`)

- **Pros:** one path on every driver; Ork validates the report
  ([node-report spec](../../specs/runtime/node-report.md)); no schema file.
- **Cons:** an extra tool call; a model that answers in text ends `no_report`.

#### Option 4B — `--output-schema` (`reportSchema: true`)

- **Pros:** no extra call; the final message is the report, as `claude-code`.
- **Cons:** a structured-output schema is often limited to a strict subset (all
  properties required, closed objects), which Ork's report schemas, with
  optional fields and the lists of objects of G21 in
  [gaps](../../specs/gaps.md), may not meet; not measured.

#### Option 4C — Report tool now; `--output-schema` measured and recorded as a gap

- **Pros:** the build of 4A; the spike tries Ork's shipped report schemas
  against `--output-schema`, and the result goes in `specs/gaps.md`.
- **Cons:** the native schema waits for a later change.

### 5. Usage and cost

#### Option 5A — Tokens only (`price: false`)

- **Pros:** reports only what Codex prints; no fabricated price table; a
  ChatGPT-account session has no per-token dollars; as `command-code`:
  `budgetTokens` binds and `ork validate` warns that `budgetUsd` alone cannot.
- **Cons:** `budgetUsd` is not enforced; cost shows as unknown.

#### Option 5B — Ork prices the tokens from a table

- **Pros:** a dollar figure and `budgetUsd` enforcement.
- **Cons:** a table of model prices Ork would have to keep true and cannot
  source from the CLI; wrong for a subscription login. Not offered to the
  maintainer: it would invent data (the skill forbids it).

### 6. Models

#### Option 6A — Codex's built-in default for the account

- **Pros:** `-m` only when the node gives `codex.<model>`, the text after the
  prefix as written
  ([ADR-083](../../decisions/ADR-083-agent-node-types-and-driver-prefixed-models.md));
  no model name in Ork that can go stale.
- **Cons:** with `--ignore-user-config` the user's own `model` is ignored, so a
  run can use a different model than the user normally does, and it can change
  with a Codex update (the resolved model is recorded as for every driver).

#### Option 6B — Refuse a Codex node with no model

- **Pros:** reproducible; no surprise model on an account.
- **Cons:** every Codex node, and `--driver codex` on an existing workflow,
  needs a model written first.

#### Option 6C — Read the user's `model` from `~/.codex/config.toml`

- **Pros:** a run matches the user's own default.
- **Cons:** Ork reads and depends on the user's config, against decision 3; a
  profile or per-project override would still be missed.

## Decision

The maintainer chose, one decision at a time:

1. **Option 1C.** Each leg is one `codex exec --json` process; a later message
   or answer waits for the leg's end and continues the session with
   `codex exec resume <id> <message>` (`codex exec fork <id>` for a question
   fork). `midTurnMessages` and `permissionPrompt` are `false`. Mid-turn
   messages and Ork-answered approvals through `codex app-server` are recorded
   as gaps in `specs/gaps.md` and left to a later RFC once app-server is not
   experimental.
2. **Option 2B.** Sandbox plus a hook, deny by default.
   - _The sandbox is the outer wall._ `plan` mode, or a node with no edit or
     shell allow, runs `read-only`; a node that may edit or run a shell runs
     `workspace-write` with the worktree as its root. Ork never passes
     `danger-full-access`, `--dangerously-bypass-approvals-and-sandbox`,
     `--approve-for-me` (a model would answer the approvals: it widens what the
     node's rules allow) or `--trust` (it saves trust in the user's Codex
     config). Because `exec resume` lists no `-s` or `-C`, every leg gets the
     sandbox as `-c sandbox_mode=…` and the folder as the process's working
     folder (the runner already sets `PWD`); the spike confirms a resumed leg
     keeps both.
   - _The hook is the node's rules._ A hook written for the session, in a
     private folder outside the checkout (0700, files 0600, removed after the
     session, as `secret-file.ts` and `command-code-mod.ts` do), refuses every
     tool call the node did not allow: Ork's own tools (`mcp__ork__*`) always go
     through; the node's rules are read in Claude Code's words, with a shell
     line checked command by command, as the command-code mod does; `yolo`
     allows what `deny` and `only` do not refuse. A rule with no Codex action is
     left out, so what it named is denied.
   - _It fails closed._ A hook that cannot load, or that Codex would run only
     behind a trust step that persists or widens what runs (`--trust`, a flag
     that also enables the checkout's hooks), ends the node with a driver error
     before any model call; it never runs a session unguarded. If the spike
     shows hooks cannot cover shell, edits and MCP calls in `exec`, the driver
     falls back to option 2A: `ork validate` and `ork run` refuse the nodes
     whose rules a sandbox cannot hold.
   - _Ork refuses rather than widens._ A deny that names a read (`Read`, `Glob`,
     `Grep` scoped to a path) is refused for this driver, because Codex has no
     read tool for the hook to gate and its read-only sandbox may read outside
     the worktree (to confirm); the limit is a new entry in `specs/gaps.md`, as
     G14 records for the other drivers.
3. **Option 3A.** Every leg passes `--ignore-user-config` and `--ignore-rules`,
   and every Ork setting (MCP server, hook, sandbox, model, effort) as `-c`; no
   `-p` profile and no `--ephemeral`. The login comes from the user's own
   `CODEX_HOME`, which Ork never reads or copies. Each session is kept in the
   user's Codex session list; the user's plugins, skills, hooks and memories
   must be confirmed off by the spike, and a gap or a further flag recorded for
   any that are not.
4. **Option 4C.** Ork's `report` tool is the report (`reportSchema: false`); the
   spike measures the shipped report schemas against `--output-schema`, and
   `specs/gaps.md` records the result.
5. **Option 5A.** Tokens only: `price: false`. Usage is read from the JSONL
   events (the spike confirms the shapes, and whether a usage report comes
   before a turn's end so `budgetTokens` can stop a running session).
   `ork validate` warns that `budgetUsd` alone does not bind this driver, as for
   `command-code`. This was decided without asking, because the only other
   option invents a price table.
6. **Option 6A.** `codex.<model>` pins the driver and passes the rest to `-m` as
   written; with no model, Codex's own default for the account applies. `codex`
   joins `DRIVER_IDS`, so `driverOf` reads the prefix; `effort` goes as a `-c`
   reasoning-effort key if the spike finds one.

What the descriptor declares follows from these: `questions: true` (Ork's tools
over MCP), `permissionPrompt: false`, `price: false`, `midTurnMessages: false`,
`reportSchema: false`, and `proven: false` until a maintainer-run, capped
session. `turnLimit`, `mcpServers` and `subagents` start `false` and
`ork validate` refuses a node that needs them until the spike measures them
(Codex `exec` has no max-turns flag in its help). `onePerCheckout` is `false`:
Ork's endpoint goes in by `-c`, with no per-folder entry to lease.

Ork's endpoint is `-c mcp_servers.ork.url=…` and
`-c mcp_servers.ork.bearer_token_env_var=<VAR>`, with the token in the leg's
environment, not its arguments (`kind: "flag"` wiring, `env`); a long
`tool_timeout_sec` is needed for `delegate`, which waits for whole child
sessions
([ORK_TOOL_TIMEOUT_MS](../../packages/runtime/src/adapters/claude-code-flags.ts)).

## Consequences

- **Positive.** A fourth driver behind the existing strategies, with no change
  to the runner, the session ports or the workflow format beyond one more driver
  id; the user's Codex login and models are used as they are; the
  deny-by-default precedent holds.
- **Negative.** A per-turn process (start-up on each leg); no mid-turn message
  or Ork-answered approval; tokens only; reads outside the worktree may not be
  fenced; a run adds sessions to the user's Codex history.
- **What a driver must change** (from the places the other drivers are named):
  - `packages/integrations`: a `codex` descriptor and id in `drivers.ts`
    (`AGENT_DRIVERS`, `DriverId`, `DRIVER_IDS`), its doctor check (see Open
    questions), `registry.test.ts`.
  - `packages/runtime`: `adapters/codex.ts` (command, flags, wiring),
    `codex-events.ts` (decoder, usage, tool names in Claude Code's words),
    `codex-hook.ts` (the session's hook), the `ADAPTERS` record in `registry.ts`
    (it does not compile without it) and the export in `index.ts`.
  - `packages/schema`: `workflow.schema.json` regenerated
    (`pnpm --dir packages/schema gen:json-schema`), `drivers.test.ts`,
    `model-driver.test.ts`; `packages/core`: `driver-needs.test.ts`,
    `model-driver.test.ts`, `budget-tokens.test.ts`; `packages/nodes`:
    `session-driver.ts` and `model-drivers.test.ts`; `packages/cli`:
    `doctor.test.ts`, `ready-driver.test.ts`, `driver-refusals.test.ts`,
    `completion*.test.ts`, `help.test.ts` and `test/fixtures/drivers.ts`.
  - **A fake `codex`** at `packages/runtime/test/fixtures/fake-codex.mjs`, as
    `fake-opencode.mjs` and `fake-command.mjs` are: JSONL on stdout,
    `exec resume` and `exec fork`, `FAKE_ENDPOINT_FILE` and every
    `FAKE_SCENARIO` the contract names (default, `invalid-report`, `try-denied`,
    `wait-message`, `hang`, `report-tool`, `extract`, `end:<kind>`); one entry
    in `test/contract/entries.ts` runs every contract case against it, with
    `TOOL_ENDS` for the causes it reports. A `codex.test.ts` beside
    `open-code.test.ts` and `command-code.test.ts` covers the arguments, the
    token never on the command line, the hook file's mode and removal, resume
    and fork arguments, and the decoder; `session-end.test.ts`,
    `provider-errors.test.ts`, `report-tool.test.ts`, `extract.test.ts` and
    `onboard-sessions.test.ts` add a Codex case where they list drivers.
  - **Specs and docs, in the same change:** a new `specs/runtime/codex.md`,
    `specs/runtime.md`, `which-driver.md`, `specs/architecture.md`,
    `specs/gaps.md` (mid-turn messages and approvals, reads outside the
    worktree, `--output-schema`, sessions kept in the user's Codex home);
    `docs/guides/drivers.md`, `accounts.md`, `installation.md`,
    `troubleshooting/setup.md`, `models-and-budgets/*`, a bullet in
    [next release](../../docs/whats-new/next-release.md), the interaction map, a
    changeset, and an ADR that ships this RFC (`pnpm rfc:close RFC-024`).
- **Follow-up work.** An RFC for `codex app-server` once it leaves experimental;
  the gate run that makes the descriptor `proven`.

## Open questions

The spike to run before building, on a real `codex` with a capped account. Each
answer changes the build, and none is assumed above.

1. **JSONL event shapes** of `codex exec --json`: the start line and the session
   id; assistant text; tool calls and their results (shell, `apply_patch`, MCP,
   web search); the final message; the error and exit-code shapes (auth, rate
   limit, out of credits, model unavailable, for the provider classifier); and
   the usage lines (which tokens, whether per request or per turn, whether
   cached input is separate), so `budgetTokens` can stop a running session.
2. **MCP over `-c`.** Whether `-c mcp_servers.ork.url=…` with
   `bearer_token_env_var` loads Ork's server for one session without touching
   `~/.codex`; whether a startup or tool timeout key exists and is long enough
   for `delegate`; whether the server's tools reach the model with Code Mode and
   plugins off; and the node's own `.mcp.json` servers (the `mcpServers`
   capability).
3. **Resume and fork with `--json`.** Whether
   `codex exec resume <id> <msg> --json` keeps the sandbox, the folder, the
   hook, the MCP server and the model of its first leg when only `-c` and the
   working folder carry them, and what `exec fork` prints.
4. **The hook.** Whether Codex hooks run in `exec`, cover shell, `apply_patch`
   and MCP calls, can be set per session by `-c` or a file outside the checkout,
   and need a trust step; whether `--dangerously-bypass-hook-trust` also enables
   the checkout's own hooks (it must not); the hook's input and the answer that
   refuses a call; and whether it can hold a paused node's call
   ([ADR-041](../../decisions/ADR-041-pause-continue-stop.md)) as
   `claude-code`'s does.
5. **The sandbox.** What `read-only` and `workspace-write` allow outside the
   worktree (reads, the private hook folder, the network, `WebFetch` and
   `WebSearch`); whether `exec` runs a command no rule matches without asking;
   and the `-c` keys for sandbox mode, network access and reasoning effort.
6. **A clean session.** What `--ignore-user-config` still lets in (the user's
   plugins, skills, hooks, memories, and a checkout's `.codex/config.toml`);
   whether `--ignore-rules` also drops project rules; whether the system prompt
   can be added to by a config key (otherwise Ork puts its instructions before
   the brief on a session's first leg, as `command-code` does); and where Codex
   keeps session files, so the gap is described truthfully.
7. **Turns, effort and model names.** Whether any config key caps a session's
   turns (the `turnLimit` capability), and which model names a ChatGPT-account
   login accepts, so a `codex.<model>` that the account refuses ends as
   `model_unavailable`.
8. **The doctor check.** Proposed, not decided: `codex --version`, then
   `codex login status` for its exit status only, never reading `auth.json`, so
   `ork doctor` and the ready driver (`ready.ts`) can say "logged in" or "sign
   in with `codex login`" as `claude auth status` does, with an `OPENAI_API_KEY`
   in the environment counted as a login if Codex reads it; the maintainer to
   confirm before it is built.
9. **`--skip-git-repo-check`.** Whether a node's worktree always passes Codex's
   git check, or the flag is needed for a node outside a repository.
10. **A minimum version.** The oldest `codex` that has every flag above, if one
    is needed, as `MIN_CLAUDE_VERSION` is for `claude`.

## What the spike found

Run by the maintainer's agent on 2026-11-18, `codex-cli` 0.169.0 signed in with
a ChatGPT account (default model `gpt-6.2-sol`), in a scratch git repository,
with a stand-in for Ork's MCP endpoint and a logging hook. Each answer is
numbered as its question above.

1. **Events.** `codex exec --json` prints one JSON object a line:
   `thread.started` (`thread_id`, the session id), `turn.started`, then
   `item.started`/`item.completed` with `item.type` `agent_message` (`text`),
   `command_execution` (`command`, `aggregated_output`, `exit_code`, `status`
   `completed` or `failed`), `file_change` (`changes[]` with `path` and `kind`),
   `mcp_tool_call` (`server`, `tool`, `arguments`, `result.content`, `error`),
   and `error` (`message`, also for warnings such as the hook-trust bypass);
   then `turn.completed` with `usage` (`input_tokens`, `cached_input_tokens`,
   `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`) or
   `turn.failed` (`error.message`) and a top-level `error`. Usage comes once, at
   the turn's end, so `budgetTokens` can stop a session only between legs. A
   call a hook refuses leaves no item: only Codex's stderr logs it, so Ork
   counts refusals from its own hook. A model the account refuses ends
   `turn.failed` with "The '<model>' model is not supported when using Codex
   with a ChatGPT account." and exit code 1, for `model_unavailable`. Auth,
   rate-limit and credit errors were not provoked.
2. **MCP over `-c`.** Loads with no file in `~/.codex`: `mcp_servers.ork.url`,
   `mcp_servers.ork.bearer_token_env_var` (the token reached the server only
   from the leg's environment), `mcp_servers.ork.tool_timeout_sec`, and
   `mcp_servers.ork.required=true` (startup fails when Ork's server is not
   ready). Ork's tools reach the model as `mcp__ork__<tool>`, but every call is
   refused ("requires approval, but approval policy is never") unless
   `mcp_servers.ork.default_tools_approval_mode="approve"` is set. The node's
   own `.mcp.json` servers were not tried.
3. **Resume and fork.** `codex exec resume <id> <msg> --json` keeps the session
   id; the hook, the MCP server and the sandbox hold when they are passed again
   on that leg (`-c sandbox_mode="read-only"` held: a write was refused), and
   the folder is the process's. `codex exec fork <id> <msg> --json` prints a new
   `thread.started` with a new id. A fork keeps the instructions of the session
   it came from; `developer_instructions` given on the fork's leg did not take,
   while on a new session they did.
4. **The hook.** A `PreToolUse` hook given inline by
   `-c hooks.PreToolUse=[{matcher=".*",hooks=[{type="command",command=…}]}]`
   runs in `exec` only with `--dangerously-bypass-hook-trust`; without it the
   hook is skipped silently and every call runs. With it, the hook saw Bash,
   `apply_patch` (as `tool_input.command`, the patch) and MCP calls
   (`mcp__ork__report`, their arguments), and its answer
   `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":…}}`
   refused the call and the model read the reason. The bypass did not run the
   checkout's own `.codex/hooks.json`: an untrusted project's configuration
   stays off ("Untrusted project-local configuration is disabled"). It is per
   invocation and saves nothing. It would also run a user-level
   `$CODEX_HOME/hooks.json` or system hook without its saved trust; the
   maintainer's machine has none. Holding a paused call was not tried; a hook's
   `timeout` is in seconds, 600 by default.
5. **The sandbox.** `read-only` lets shell commands read outside the folder
   (`/etc/hosts`, a file in the home folder) and blocks writes and the network
   (a `curl` failed). `workspace-write` let `apply_patch` add a file in the
   folder; its network is off unless `sandbox_workspace_write.network_access`.
   No approval was asked in `exec`: the hook input reports
   `permission_mode: "bypassPermissions"`, so the hook and the sandbox are the
   only fences.
6. **A clean session.** `--ignore-user-config` and `--ignore-rules` leave the
   user's plugins on: a plugin's skill was read and doubled the first turn's
   input. `--disable plugins --disable apps --disable remote_plugin` turned them
   off. Skills still load: the bundled ones (with `skills.bundled.enabled=false`
   too) and the user's own (`~/.agents/skills`, `~/.codex/skills`), by name and
   description. Memories are off by default (`features.memories`).
   `developer_instructions` adds to the system prompt on a session's first leg.
   Sessions are kept in `$CODEX_HOME/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`.
   A new session with plugins off started at about 19,000 input tokens.
7. **Turns, effort, models.** No key caps a session's turns (`turnLimit` stays
   `false`). `model_reasoning_effort` is the effort key. The account's default
   model ran; a made-up one was refused as above.
8. **The doctor check.** `codex login status` exits 0 when signed in and 1 with
   an empty `CODEX_HOME`; the maintainer confirmed the check as proposed.
9. **`--skip-git-repo-check`.** Not needed in a git repository, where every
   worktree node runs; a node outside one was not tried.
10. **A minimum version.** Every flag above is in 0.169.0, the version tried.

**Decided after the spike** (the maintainer, 2026-11-18):

- **The hook runs with `--dangerously-bypass-hook-trust` on every leg**, the
  only way `exec` runs a hook Ork wrote. So that no other hook runs untrusted
  beside it, the driver ends the node with a driver error before any model call
  when a user-level `$CODEX_HOME/hooks.json` or the system hooks file
  (`/etc/codex/hooks.json`) exists; a checkout's own hooks stay off as an
  untrusted project's configuration. The spec and `specs/gaps.md` record it.
- **Every leg also passes**
  `--disable plugins --disable apps --disable remote_plugin` and, on Ork's
  server, `default_tools_approval_mode="approve"` and `required=true`; Ork's
  instructions go in `developer_instructions` on a session's first leg.
- **Skills are a gap, not fixed:** a Codex session sees the bundled skills and
  the user's own, by name and description, unlike a clean Claude Code session.
  `specs/gaps.md` records it, to revisit when Codex can turn them off.
- **Reads outside the worktree** are the gap the Decision expected (the sandbox
  reads anywhere; no read tool for the hook), and nodes with a read deny stay
  refused for this driver.
