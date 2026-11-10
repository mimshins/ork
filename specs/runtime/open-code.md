# The `open-code` driver

_Part of [Runtime: the agent drivers](../runtime.md)._

Status: **Built, unproven**: the adapter
([open-code.ts](../../packages/runtime/src/adapters/open-code.ts),
[config](../../packages/runtime/src/adapters/open-code-config.ts),
[events](../../packages/runtime/src/adapters/open-code-events.ts)), the private
config folder ([secret-file.ts](../../packages/runtime/src/secret-file.ts)), and
a stand-in `opencode`
([fake-opencode.mjs](../../packages/runtime/test/fixtures/fake-opencode.mjs))
that passes the [contract suite](../../packages/runtime/test/contract/) and the
driver's own [tests](../../packages/runtime/test/open-code.test.ts). The
descriptor stays `proven: false`, so `ork validate` and `ork run` refuse it,
until the maintainer's capped real session (plan task 21). Why:
[RFC-014](../../rfcs/archived/RFC-014-cli-drivers-only.md) (its open questions 1
to 3 hold the spike this follows).

## The session

Each leg is one process of the user's own `opencode` (2.1.0), started in the
node's worktree:

```sh
opencode run --standalone --format json --agent ork \
  [--model <provider/model>] [--session <id> [--fork]] <message>
```

| Concern            | `open-code`                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server             | `--standalone`: a private server built from the session's environment; the shared background service would ignore it                                                      |
| Working folder     | the process's `cwd`, the node's worktree (`opencode run` has no folder argument); `external_directory` is denied                                                          |
| Brief and messages | the last argument; a message sent mid-session waits for the leg's end, and the next leg continues the session with `--session <id>` and the message                       |
| System prompt      | `systemAppend` in a file of the private folder, listed in the config's `instructions`, which OpenCode adds to its own prompt                                              |
| Ork's tools        | the config's `mcp.servers.ork`: `remote`, the endpoint's URL, `oauth: false`, `codemode: false`, the bearer token in `headers`; the model sees `ork_<tool>`               |
| The node's servers | each `.mcp.json` entry the node names, as a `local` server (`command` and `args` as one list, `env` as `environment`) or a `remote` one (`url`, `headers`), Code Mode off |
| Report             | Ork's `report` tool (`reportSchema` is false); the session ends with the last report it accepted                                                                          |
| Model              | `--model` as the node gives it; OpenCode needs `provider/model` (RFC-015 settles the names)                                                                               |
| Turn cap           | `maxTurns` is written as the `ork` agent's `steps`; `turnLimit` stays false until a real run shows the cap holds                                                          |
| Resume and fork    | `--session <id>`; with `fork`, `--fork`                                                                                                                                   |
| Interrupt          | SIGINT; OpenCode interrupts its session and exits 130, read as `interrupted`                                                                                              |
| Pause              | no hook to hold a call: a paused node's session runs to its leg's end                                                                                                     |

## The config file

`OPENCODE_CONFIG` names `opencode.json` in a private folder under the system's
temporary folder (`ork-sessions/<pid>-…`, 0700), written at 0600 with the
instructions file beside it. It holds the bearer token, so it is never logged
and never in an event; the token is not on the command line. The folder goes
when the session ends, after a failure too, and a folder whose process is gone
(a crash) goes when the next session makes its own. OpenCode's private server
prints the config it loaded, headers included, so Ork never prints its output
outside the decoded events.

## Permissions: deny by default

`opencode run` asks nothing: a rule's `ask`, or no matching rule, is a request
it rejects. With no rules at all a shell call runs, so the adapter writes the
whole rule set every session, never `--auto`. The last matching rule wins:

1. `* *` deny.
2. `read <worktree>/*` allow, as `claude` reads without asking; under
   `acceptEdits`, `edit <worktree>/*` too.
3. The node's allows: `Read`, `Glob`, `Grep` as `read`, `glob`, `grep`; `Edit`,
   `Write`, `MultiEdit`, `NotebookEdit` as `edit` (a bare one in the worktree);
   `Bash(<cmd>)` as `shell <cmd>` (`git status:*` is `git status *`);
   `WebFetch`, `WebSearch`, `Task`, `Skill`, `TodoWrite` as `webfetch`,
   `websearch`, `subagent`, `skill`, `todowrite`; `mcp__<server>__<tool>` as
   `<server>_<tool>`. A tool with no OpenCode action is left out, so denied.
   With `only`, a built-in tool outside it is left out.
4. `ork_*` allow.
5. `read *.env` deny, after any read allow.
6. In `plan` mode, `edit` and `shell` deny.
7. The node's denies.

## What a session loads

The machine's and the project's OpenCode setup stay out: `XDG_CONFIG_HOME` is an
empty folder beside the config file (the user's `~/.config/opencode` and its MCP
servers drop out; the login, under `XDG_DATA_HOME`, stays),
`OPENCODE_DISABLE_PROJECT_CONFIG=1` drops the checkout's `opencode.json`,
`OPENCODE_DISABLE_CLAUDE_CODE` and `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` stop
OpenCode reading `.claude/` and `CLAUDE.md`, and `OPENCODE_CONFIG_DIR` and
`OPENCODE_CONFIG_CONTENT` are emptied. The project's own `.mcp.json` and files
are never touched. The repository's `AGENTS.md` loads.

## Events and usage

`--format json` prints `{type, timestamp, sessionID, part}` lines, as read from
the 2.1.0 source: `step_start`, `text`, `tool_use` (a finished call;
`state.status` `completed` or `error`), `step_finish` (`cost` in dollars,
`tokens` with `input`, `output`, `reasoning`, `cache.read`, `cache.write`) and
`error`. There is no result line. A leg's decoder starts the session at the
first line naming it, keeps the last `text` as the final text, sums each
`step_finish` (a turn each; reasoning counts as output), and at the process's
exit ends the session: `success` on exit 0, `error_during_execution` with the
printed errors otherwise, or `error_driver` with the stderr's last block when it
printed none. Legs add up, cost included: each reports only its own steps. Tool
names come back in Claude Code's words (`shell` is `Bash`, `ork_report` is
`mcp__ork__report`), the words a node's rules use.

## Unmeasured until the real run

- That `ork_report` is in the model's tool list with Code Mode off.
- That the model's `shell` tool starts in the worktree, and a path outside it is
  refused.
- How `shell` allow-lists behave: the spike's evaluator refused some commands a
  rule allowed, so a node may get less than it asked for.
- The exact tool names in `tool_use` lines (taken to be the permission actions).
- That `steps` caps the turns, and that a message starting with `-` is read as
  the message.
- That an empty `OPENCODE_CONFIG_DIR` adds no config source, and whether the
  `.claude/` switches change anything.
