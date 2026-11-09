# RFC-014 — CLI drivers only: claude, OpenCode and Command Code

- **Status:** Proposed
- **Date:** 2026-11-10
- **Supersedes:** —
- **Superseded by:** —

## Context

Ork has two drivers behind one port, `ClaudeRuntime`
([types.ts](../../packages/core/src/runtime/types.ts),
[ADR-005](../../decisions/ADR-005-one-runtime-port-two-drivers.md)): the Agent
SDK ([sdk.ts](../../packages/runtime-claude/src/sdk.ts)) and the headless
`claude` CLI ([cli.ts](../../packages/runtime-claude/src/cli.ts)). The registry
already keys a factory by driver id
([ADR-022](../../decisions/ADR-022-integration-registry.md)), so a new driver is
one descriptor and one factory.

The maintainer wants two changes: stop supporting the SDK driver, and let Ork
run OpenCode and Command Code, all through their CLIs. What that does to the
workflow file (node names, models, token budgets) is
[RFC-015](./RFC-015-format-for-several-drivers.md).

**The SDK driver has a cost and no user here.** It brings the runtime dependency
`@anthropic-ai/claude-agent-sdk`, a second path through every session feature,
and tests for both. The maintainer's machine can't run it and won't for a long
time, so it gets no real runs (C12 in [gaps](../../specs/gaps.md) was narrowed
to the CLI for this reason). The CLI driver passes the whole environment to
`claude` and only adds to it
([cli.ts](../../packages/runtime-claude/src/cli.ts),
[clean.ts](../../packages/runtime-claude/src/clean.ts)), so API-key, Bedrock and
Vertex settings already reach it.

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
  ([RFC-015](./RFC-015-format-for-several-drivers.md)).

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

1. **Why OpenCode's model didn't see Ork's tool.** The endpoint was connected
   and listed; the model offered only OpenCode's tools. A tool permission, the
   agent's tool list, or the setting that turns off Code Mode may hide it. Until
   this is solved, OpenCode can only run plain workers.
2. **OpenCode's working folder.** Its shell ran in the folder above the
   checkout. Ork must pin it to the node's worktree, maybe with `opencode run`'s
   directory argument; a session writing outside its worktree breaks isolation.
3. **OpenCode's defaults are open.** With no rules, a shell call ran unasked, so
   the adapter has to write a full deny-by-default rule set for every session,
   and a test must prove it.
4. **Internal names.** With more than one tool behind it, `ClaudeRuntime` and
   the package `@krapht/ork-runtime-claude` need neutral names, such as
   `AgentRuntime` and `@krapht/ork-runtime`. No file a user writes names them,
   so the rename can be its own change, before the first new adapter.
