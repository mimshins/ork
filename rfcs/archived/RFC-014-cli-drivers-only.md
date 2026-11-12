# RFC-014 — CLI drivers only: claude, OpenCode and Command Code

- **Status:** Implemented
- **Date:** 2026-11-10
- **Supersedes:** —
- **Superseded by:** —

## Context

Ork has two drivers behind one port, `ClaudeRuntime`
([types.ts](../../packages/core/src/runtime/types.ts),
[ADR-005](../../decisions/ADR-005-one-runtime-port-two-drivers.md)): the Agent
SDK (`sdk.ts`, removed by RFC-014) and the headless `claude` CLI
([cli.ts](../../packages/runtime/src/adapters/claude-code.ts)). The registry
already keys a factory by driver id
([ADR-022](../../decisions/ADR-022-integration-registry.md)), so a new driver is
one descriptor and one factory.

The maintainer wants two changes: stop supporting the SDK driver, and let Ork
run OpenCode and Command Code, all through their CLIs. What that does to the
workflow file (node names, models, token budgets) is
[RFC-015](../archived/RFC-015-format-for-several-drivers.md).

**The SDK driver has a cost and no user here.** It brings the runtime dependency
`@anthropic-ai/claude-agent-sdk`, a second path through every session feature,
and tests for both. The maintainer's machine can't run it and won't for a long
time, so it gets no real runs (C12 in [gaps](../../specs/gaps.md) was narrowed
to the CLI for this reason). The CLI driver passes the whole environment to
`claude` and only adds to it
([cli.ts](../../packages/runtime/src/adapters/claude-code.ts),
[clean.ts](../../packages/runtime/src/adapters/claude-code.ts)), so API-key,
Bedrock and Vertex settings already reach it.

**The port is CLI-shaped, but its contract is Claude Code's.** `buildCliArgs`
depends on flags that only `claude` has. Each is something Ork promises:

| What Ork relies on                  | `claude`                               | OpenCode 2.1.0 (`opencode run`)                                                  | Command Code 1.88.5 (`cmd -p`)                                                |
| ----------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Machine-readable events             | `stream-json`                          | `--format json`: `step_start`, `tool_use`, `step_finish`, `text`: measured       | `--output-format json`: NDJSON events and one result line: measured           |
| Resume, fork                        | `--resume`, `--fork-session`           | `--session`, `--continue`, `--fork`                                              | `--resume`, `--continue`, `--fork-session`                                    |
| Model                               | `--model`, `--effort`                  | `--model provider/model#variant`                                                 | `--model`                                                                     |
| Turn limit                          | `--max-turns`                          | none found on `opencode run`                                                     | `--max-turns`, exit code 8                                                    |
| A report in a declared shape        | `--json-schema`                        | none found                                                                       | none found (a separate typed-model route exists, not for coding sessions)     |
| Ork's tools over MCP, per session   | `--mcp-config`                         | `OPENCODE_CONFIG` per process: connects, but the model didn't see the tool       | local scope per checkout, outside it: measured                                |
| Ask Ork for each permission         | `--permission-prompt-tool`             | rules allow, deny or ask; no callback; with no rules, a shell call ran: measured | rules, `dont-ask`, `--yolo`; no callback; blocked calls fail closed: measured |
| Per-session budget                  | `--max-budget-usd`, cost in the result | no cap; each `step_finish` has `cost` in dollars and `tokens`: measured          | no cap; the result has tokens, no dollars: measured                           |
| A message while a session runs      | stream-json input                      | not on `run`                                                                     | not on `-p`                                                                   |
| A login Ork never touches (ADR-004) | `claude auth`                          | `opencode auth`                                                                  | `cmd login`                                                                   |

Both tools also have a richer way in that this table doesn't cover: OpenCode has
a server, `opencode api` and `opencode acp`, and Command Code has `cmd acp`. A
client of those may be able to answer permission requests and send messages.

Sources: `opencode run --help` (2.1.0, run here); the flags in the published
`command-code` 1.88.5 package; and the
[OpenCode](https://opencode.ai/docs/permissions/) and
[Command Code](https://commandcode.ai/docs/core-concepts/headless) docs. "None
found" means not in those sources, not proven absent.

Measured on 2026-11-10, in throwaway repositories with a stand-in for Ork's MCP
endpoint:

- **OpenCode 2.1.0,** on `commandcode/deepseek/deepseek-v4.1-flash` through its
  Command Code provider (its own free tier was used up):
  - With `OPENCODE_CONFIG` pointing at a file outside the repository,
    `opencode run --standalone` connected to the endpoint, sent its
    `Authorization` header and listed its tools. The model then said no `report`
    tool existed and offered OpenCode's own tools instead, so the tool didn't
    reach it. Why is open.
  - It also loaded the machine's own MCP servers from the user's config: no
    strict mode was set.
  - With no permission rules and no `--auto`, the model's `echo hi` ran without
    asking, and the shell's working folder was the one above the checkout, not
    the checkout `opencode run` was started in.
  - Events: `step_start`, `tool_use` (tool, input, output, exit), `step_finish`
    (reason, `cost` in dollars, and `tokens` with input, output, reasoning and
    cache read and write), and `text`. No final result line.
- **Command Code 1.88.5,** on the free `stealth/glyph-cluster:free` model:
  - A `.mcp.json` in the checkout was read in `-p` mode with no prompt, and the
    model called the endpoint's `report` tool with the header sent.
  - Events came as `{"type":"event"}` frames (`tool_queued`, `tool_running`,
    `tool_completed`, `tool_hook_blocked`, `text_delta` and more), then one
    `{"type":"result"}` line with `subtype`, `sessionId`, `stopReason`, token
    `usage` and `finalText`, and no cost.
  - With no flags, a shell call was blocked, the session went on, and the run
    ended `success`.
  - An `ork` entry added with `cmd mcp add --scope local` in one checkout was
    written under `~/.commandcode/projects/`, used by a session there, unseen by
    a session in a second checkout, and left both checkouts clean.

## Options

### Option A — CLI drivers with declared capabilities

Remove the SDK driver. Keep one port. Each driver declares what it can do
(`questions`, `permissionPrompt`, `price`, `midTurnMessages`, `reportSchema`,
`turnLimit`). `ork validate` and `ork run` refuse a node that needs something
its driver lacks, in words that name both. Where a driver lacks a feature, Ork
supplies it the same way for every driver or refuses:

- **Report:** a `report` tool on Ork's MCP endpoint, validated against the
  node's schema, for drivers without `--json-schema`.
- **Permissions:** the node's allow and deny lists are written as the tool's
  rules, and anything else is denied. No driver but `claude` asks mid-session.
- **Messages:** delivered at the next leg by resuming the session, as `cli.ts`
  does between legs.
- **Budget:** enforced from what each driver reports, in dollars or tokens
  ([RFC-015](../archived/RFC-015-format-for-several-drivers.md)).

`claude` stays the full-featured driver. Adapters ship one at a time, each only
after a real run shows it works.

- **Pros:** One less driver and dependency. A mistake surfaces in `validate`,
  before any money is spent (prevention over detection). The registry pattern
  stays as it is. Nothing is promised that a tool can't do.
- **Cons:** Workflows aren't portable between drivers once they use a feature
  only one has. Fail-closed permissions will stop some runs that `claude` would
  have asked about.

### Option B — The common denominator

Reduce every driver to what all three share: prompt in, events and final text
out, `--yolo` or `--auto` for permissions.

- **Pros:** Smallest adapters. Every workflow runs anywhere.
- **Cons:** Loses leaders, `ask_user`, budgets and per-tool permissions, which
  are what Ork is for. Auto-approving every tool breaks its safety model.

### Option C — Protocol drivers for the other two

Drive OpenCode through its server or ACP and Command Code through `cmd acp`, as
long-lived clients.

- **Pros:** Could give permission callbacks and mid-session messages, closing
  the largest gaps in Option A.
- **Cons:** Two new client protocols, which aren't one CLI invocation per leg,
  against a request that says CLI drivers. OpenCode's background service is
  shared state to isolate per run. The protocols weren't assessed here.

### Option D — Add the two CLIs, keep the SDK driver

- **Pros:** Users on the SDK driver lose nothing.
- **Cons:** Keeps the untested path and dependency, against the maintainer's
  direction, while the CLI driver already reaches API-key and cloud accounts.

## Decision

The maintainer chose **Option A** on 2026-11-10, with the choices below. Option
C stays open as a later change to a single adapter, if a real run shows the CLI
route falls short.

- **Driver ids:** `claude-code`, `open-code` and `command-code`, replacing `cli`
  and `sdk`.
- **`ork doctor`** calls `claude-code` ready when `claude` is logged in, or when
  `ANTHROPIC_API_KEY` or a `CLAUDE_CODE_USE_*` provider is set, and says which.
  This is the SDK driver's check, moved over.
- **Ork's MCP endpoint reaches every driver the same way:** one session's
  config, outside the checkout, so the worktree stays clean and a project's own
  `.mcp.json` is never touched.
  - `claude-code`: `--mcp-config`, as today.
  - `open-code`: a config file in Ork's run folder, named by `OPENCODE_CONFIG`.
  - `command-code`: an `ork` entry in Command Code's local scope for that
    checkout (`~/.commandcode/projects/<path>/mcp.json`), added through
    `cmd mcp add --scope local` before the session and removed after it. Because
    that entry is per folder, **Ork runs at most one Command Code session per
    checkout at a time**. Another waits for it, and `ork validate` warns when a
    workflow would make sessions queue this way. The entry sits in the user's
    own local scope for the project, so it is removed after the session and
    after a crash, on the next run or `ork doctor`, leaving their other entries
    as they were.

### Design: one port, adapters built from small strategies

The maintainer asked for a design that takes the next tool (Codex, say) as
easily as these two. Ports and adapters, as the engine already has
([ADR-005](../../decisions/ADR-005-one-runtime-port-two-drivers.md),
[ADR-022](../../decisions/ADR-022-integration-registry.md)), extended one level
down:

- **The engine's port stays one interface.** `@krapht/ork-core` knows a session
  only through the runtime port (`start(spec, ports)` returning normalized
  events, `send` and `interrupt`). Nothing in core names a tool. The port is
  renamed from `ClaudeRuntime` to a neutral name (open question 4).
- **A driver is a descriptor plus an adapter, found by id.** The descriptor
  (`@krapht/ork-integrations`) holds the id, label, `ork doctor` check and the
  driver's **capabilities**, as data. `ork validate` reads only the
  capabilities, so a new driver needs no change to the compiler. The adapter (in
  the runtime package) is registered under the same id; the registry's
  `Record<DriverId, …>` already refuses to compile a descriptor without one.
- **One CLI session runner, many strategies.** Spawning the process, legs,
  resuming a session to deliver a message between legs, interrupting, timeouts
  and the stop signal are shared code, written once. An adapter supplies only
  what differs, each behind its own small interface:
  - **Command:** the binary and the arguments for a spec (model, turn limit,
    resume or fork, output format).
  - **Event decoder:** one line of the tool's output into Ork's normalized
    events, including the session id and the final report.
  - **MCP wiring:** how a session gets Ork's endpoint: a flag (`claude-code`), a
    config file named by an environment variable (`open-code`), or a lease on a
    per-folder entry, held for the session and released after it
    (`command-code`). The lease kind is where "one session per checkout" lives,
    so the runner doesn't know it.
  - **Permission policy:** a node's allow and deny lists into the tool's own
    rules, deny by default, or the tool's callback where there is one.
  - **Usage reader:** tokens, and dollars when the tool reports them.
  - **Context layers:** where the tool reads instructions, skills and agents,
    and how the machine's own setup is kept out.
- **Shared code before a new strategy.** When a second adapter needs the same
  behaviour, such as writing a config file outside the checkout, it becomes one
  shared helper both use, not a copy.
- **One contract suite for every adapter.** The same tests run against each
  adapter and its fake tool: events normalize the same, a report validates, a
  denied tool stays denied, the MCP endpoint is reached and removed, usage is
  counted, and an interrupt ends the session. A new tool is done when it passes
  the suite and one capped real session.

Adding Codex is then a descriptor, an adapter made of those strategies, a fake,
and a green contract suite, with no edit to the engine, the compiler or the
other drivers.

Proposed order, each a separate change: remove the SDK driver; extract the CLI
session runner and its strategies from `cli.ts`, with the contract suite,
`claude-code` passing it unchanged; add capability declarations and refusals;
add the `report` tool; Command Code; OpenCode, once its open questions below are
answered.

## Consequences

- **Format:** `driver: sdk` and `driver: cli` stop being valid; `ork validate`
  must say what to use instead. The new driver ids reach `.ork/project.yaml`,
  `--driver` and the UI (`DRIVER_IDS`,
  [settings.ts](../../packages/schema/src/settings.ts)).
- **Removed:** `sdk.ts`, the `sdk` descriptor in
  [drivers.ts](../../packages/integrations/src/drivers.ts), the
  `@anthropic-ai/claude-agent-sdk` dependency, and the SDK's tests. Whether
  `@anthropic-ai/sdk` then has any importer needs checking.
- **ADRs:** a new ADR supersedes the two-driver decision in ADR-005 and touches
  ADR-064 and ADR-065. ADR-011's MCP endpoint becomes the shared route for all
  drivers.
- **Docs:** `README.md`, the installation guide, `specs/runtime.md`,
  `SECURITY.md`, AGENTS.md's description of Ork, the interaction map and about
  45 files that mention the SDK driver.
- **Context layers:** instructions, skills, agents and MCP servers differ per
  tool (`.claude/` against OpenCode's and Command Code's own places). Each
  adapter must say which layers it honours, and keep the machine's own MCP
  servers out of a session as `claude-code` does
  ([ADR-065](../../decisions/ADR-065-clean-claude-sessions.md)).
- **Nodes on different drivers work together.** Delegation, `ask_user`, links
  and messages go through the engine and Ork's MCP endpoint, not through any
  tool, so a Command Code leader can delegate to a `claude-code` worker, and
  nodes on different drivers can message each other. What differs is delivery:
  `claude` takes a message mid-turn, while the others take it at their next leg
  or when they read their inbox.
- **Fake drivers:** each adapter needs a stand-in like `fake-claude.mjs`, so its
  tests cost nothing.

## Open questions

Questions 1 to 3 were worked through on 2026-11-10 (plan task 17) without a
model session: `opencode` 2.1.0's help, its config JSON Schema
(`https://opencode.ai/config.json`), its docs, and a throwaway private server
(`opencode serve` and `opencode api --standalone`, with `XDG_*` folders and a
stand-in MCP endpoint under `/tmp`). Each carries a status: **Answered on
paper** means the config or rule was checked against a running server but the
model's behaviour was not; **Needs a paid real session** lists the exact
command. The maintainer runs the paid sessions.

Two facts that shape every answer:

- By default `opencode run` talks to a per-user **background service** that owns
  config, permissions and tool execution. Its environment is fixed when the
  service starts, so a caller's `OPENCODE_CONFIG` or `XDG_*` never reaches it
  (`opencode debug config` ignored both). Every Ork session must use
  `--standalone`, which starts a private server from the caller's environment.
- The server prints the config it loaded, headers included. The bearer token
  shows in plain text in `GET /api/config`. Ork must not log that output.

1. **Why OpenCode's model didn't see Ork's tool.** _Status: answered on paper;
   needs a paid real session to confirm._

   **Code Mode** is the likely cause. It is on by default: an MCP server's tools
   are not in the model's tool list but behind one `execute` tool that runs
   JavaScript, as `tools.<server>.<tool>(...)`. The model saw `execute` and
   OpenCode's own tools, and rightly found no `report` tool. The fix is
   `"codemode": false` on the server's entry. Its tools are then listed
   directly, named `<server>_<tool>` (characters other than letters, digits, `_`
   and `-` become `_`): `ork_report`, `ork_ask_user`, `ork_delegate`. Each is
   also a permission action of that name, so the rules need `ork_*` allowed. The
   deny-by-default set in question 3 denies `execute`, which removes the Code
   Mode path, so `codemode: false` is required, not optional.

   ```json
   {
     "mcp": {
       "servers": {
         "ork": {
           "type": "remote",
           "url": "http://127.0.0.1:<port>/mcp",
           "oauth": false,
           "codemode": false,
           "headers": { "Authorization": "Bearer <token>" }
         }
       }
     }
   }
   ```

   Checked here: with `OPENCODE_CONFIG` naming this file, a private server
   connected (`POST /api/experimental/mcp/ork/connect`, then `GET /api/mcp`
   showed `connected`), the stand-in saw `Authorization: Bearer …` on
   `initialize`, `notifications/initialized` and `tools/list`, and the rule
   `ork_*` evaluated `allow`. `oauth: false` is needed so OpenCode does not try
   OAuth discovery against a header-token endpoint. Not checkable without a
   model: that `ork_report` is in the model's list. Note the config also has an
   `agents.<id>.steps` field and no per-agent tool list, so the agent's tool
   list is not the cause.

   _Paid session (confirms questions 1 to 3 together), in a throwaway repo with
   a stand-in MCP endpoint, a cheap model and `steps: 4` as the cap (the CLI has
   no dollar cap):_

   ```sh
   cd <throwaway checkout> && \
   XDG_CONFIG_HOME=<empty dir> OPENCODE_CONFIG=<ork.json> \
   OPENCODE_DISABLE_PROJECT_CONFIG=1 \
   opencode run --standalone --format json --agent ork -m <provider/model> \
     "Call the ork_report tool with text hi. Then run pwd with the shell tool. \
      Then read ./.env. Say what happened."
   ```

   _Expect:_ a `tool_use` for `ork_report` that the stand-in endpoint received;
   `pwd` run only when `ork.json` allows `shell` `pwd` (second run), and
   printing the checkout; the `.env` read and any other shell call refused. If
   the model still reports no `ork_report` tool, open question 1 is not solved:
   stop and take the fallback in the plan (plain workers only).

2. **OpenCode's working folder.** _Status: answered on paper; needs a paid real
   session to confirm (same command as question 1, second run)._

   `opencode run` has no directory flag; its usage is
   `opencode run [flags] [<message...>]`. The `[<directory>]` argument belongs
   to the bare `opencode` command. The session's **Location** comes from the
   process: a private server started from `/tmp/oc-spike/proj` reported
   `location.directory` as that folder, and a session created with another
   `location.directory` ran `pwd` in that folder (through the session shell API,
   which is the user's shell, not the model's `shell` tool). So Ork spawns
   `opencode run` with `cwd` set to the node's worktree.

   The earlier measurement, a shell one folder above the checkout, is probably
   the model's `shell` tool passing its own `workdir` argument (the docs say it
   is set by `workdir`, not `cd`, and do not state a default). That is
   unconfirmed. Belt and braces: `external_directory` governs paths outside the
   Location, and its default is allow, so the deny-by-default set (question 3)
   denies it. A shell command's `cd` targets are checked the same way, "best
   effort" per the docs. Needs a paid session: that the model's own shell tool
   starts in the checkout, and that an outside path is refused.

3. **OpenCode's defaults are open.** _Status: deny-by-default answered and
   checked on a running server; shell allow-lists need a paid real session._

   Rules are an ordered array under `permissions` (the v1 key `permission` is
   deprecated; `bash` is now `shell`, `task` is `subagent`). Each rule is
   `{ "action", "resource", "effect" }`, with effect `allow`, `deny` or `ask`.
   The **last matching rule wins**, no match means `ask`, and `*` matches any
   run of characters including `/`. The server (`GET /api/agent`) shows the
   order an agent really gets: its base policy (`* allow`; `.env` reads ask; the
   `build` agent also allows `question`), then the config's `permissions`, then
   the agent's own `permissions`, then the shipped `browser` deny. So a config
   that starts with `{ "action": "*", "resource": "*", "effect": "deny" }`
   overrides the open base, and the allows after it open only what the node
   named. Actions: `read`, `edit` (also `write` and `patch`), `glob`, `grep`,
   `shell`, `subagent`, `skill`, `question`, `webfetch`, `websearch`,
   `external_directory`, `execute`, `<server>_<tool>`.

   Evaluated with `POST /api/session/{id}/permission` (it evaluates a rule set
   without a model) against a config of `* deny`, `read <worktree>/*` allow,
   `read *.env` deny, `ork_*` allow: `shell`, `glob`, `grep`, `webfetch`,
   `websearch`, `question`, `execute`, `subagent`, `skill`,
   `external_directory`, `browser` and an unlisted tool all returned `deny`;
   `read` in the worktree and `ork_ask_user` returned `allow`; `read` of the
   worktree's `.env` and of `/etc/passwd` returned `deny`; `edit` returned
   `deny` until an `edit` allow was added.

   The adapter should write, in this order, for every session:

   ```json
   {
     "permissions": [
       { "action": "*", "resource": "*", "effect": "deny" },
       { "action": "read", "resource": "<worktree>/*", "effect": "allow" },
       { "action": "read", "resource": "*.env", "effect": "deny" },
       { "action": "ork_*", "resource": "*", "effect": "allow" }
     ],
     "agents": { "ork": { "mode": "primary", "steps": 40 } }
   }
   ```

   plus, from the node, rules after the deny line: `Read`, `Grep`, `Glob` map to
   `read`, `grep`, `glob`; `Edit`, `Write` to `edit`; `Bash(<prefix>)` to
   `shell` with `<prefix> *`; `WebFetch`, `WebSearch`, `Task`, `Skill` to
   `webfetch`, `websearch`, `subagent`, `skill`; a node's deny list goes last.

   Things the checks showed that the adapter and its test must respect:

   - A broad `read *` allow overrides the base `.env` ask, so a read allow must
     be scoped to the worktree and `read *.env` denied after it.
   - Never pass `--auto`: it approves every request that is not denied.
   - `external_directory` has no dedicated test here: the raw evaluator does not
     combine it with `read`, which real tool calls do.
   - **Shell allow-lists behaved unpredictably in the evaluator.** With
     `shell git *` allowed, `git status` and `git log` still returned `deny`,
     `cat f.txt` returned `deny` while `cat /etc/passwd` returned `allow`, and a
     bare `ls` flipped between runs as other rules changed. Fail-closed is the
     safe direction, and the docs say the scanner also checks `cd` targets and
     path arguments, which may explain it, but a node that allows
     `Bash(git status:*)` may get less than it asked for. Needs a paid session:
     one run with `shell git status *` allowed, and the result recorded in the
     spec.
   - Project config loads **after** `OPENCODE_CONFIG`, so a checkout's own
     `opencode.json` could append rules that win. Disable it (below). Top-level
     `policies` are hard denies that "override project configuration"; they are
     an alternative, not tried here.

   **Keeping the machine's setup out.** Checked by listing `GET /api/config`
   (the loaded sources) on a private server:

   - The user's global `~/.config/opencode/opencode.json` (here it defines an
     `aws-mcp` server) is dropped by
     `XDG_CONFIG_HOME=<empty folder in the run folder>`; only the empty folder
     and the `OPENCODE_CONFIG` file were listed. The login seems to live in the
     data folder (`opencode.db`, under `XDG_DATA_HOME`), which stays untouched,
     so it should survive. The paid session confirms the login still works.
   - `OPENCODE_CONFIG=<file>` loads between the global and the project config.
     Put the file at 0600 in the run folder, outside the checkout.
   - `OPENCODE_DISABLE_PROJECT_CONFIG=1` and `OPENCODE_CONFIG_PROJECT_DISABLE=1`
     both drop the checkout's `opencode.json` from the loaded sources. Set the
     first; it keeps a project's own MCP servers and rules out of the session.
     The project's own files are not touched.
   - `OPENCODE_CONFIG_DIR=<folder>` adds a folder to the sources, so it does not
     exclude anything. `OPENCODE_CONFIG_CONTENT` takes inline JSON, which would
     put the token in the process environment; the file is better.
   - `OPENCODE_DISABLE_CLAUDE_CODE` and `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`
     exist in the binary and are meant to stop OpenCode reading `.claude/` and
     `CLAUDE.md`. Their effect was not observable here: `GET /api/skill` listed
     no skills with or without them, from a `.claude/skills` in a fake `HOME` or
     in the project. Set both in the adapter and let the paid session or the
     context-layers task show whether they matter.

   **Other findings the adapter needs.**

   - **Turn limit.** The earlier table says none. The agent field `steps` (a
     positive integer) caps model steps: on the last step OpenCode removes the
     tools and asks the model for a text summary. So `maxTurns` can be written
     as `agents.ork.steps`, and `turnLimit` can be true. The run does not fail
     at the limit, so the decoder must count `step_finish` events and report
     `error_max_turns` itself. Needs a paid session: set `steps: 2` and check
     the last step has no tool call.
   - **Session flags** (`opencode run --help`): `--session <id>` ("continue, or
     create if it does not exist"), `--continue`, `--fork`,
     `--model provider/model#variant`, `--agent`, `--format default|json`,
     `--title`, `--file`. A new session's id arrives in the output; whether a
     chosen id is accepted is unchecked (ids look like `ses_…`).
   - **Events** (`--format json`, measured; the flag is not documented beyond
     `--help`): `step_start`, `tool_use` (tool, input, output, exit),
     `step_finish` (reason, `cost` in dollars, `tokens` with input, output,
     reasoning, cache read and write), `text`; no result line. The server's data
     model agrees: an assistant message has `finish` (`stop`, `length`,
     `tool-calls`, `content-filter`, `error`, `unknown`), `cost` and `tokens`.
     Exact field names of the CLI lines still come from the fake tool's
     recording of a real run.

4. **Internal names.** With more than one tool behind it, `ClaudeRuntime` and
   the package `@krapht/ork-runtime-claude` need neutral names, such as
   `AgentRuntime` and `@krapht/ork-runtime`. No file a user writes names them,
   so the rename can be its own change, before the first new adapter.
   **Resolved** by the maintainer:
   [ADR-074](../../decisions/ADR-074-neutral-runtime-names.md).
