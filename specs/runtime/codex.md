# The `codex` driver

_Part of [Runtime: the agent drivers](../runtime.md)._

Status: **Built and proven**: the `codex` descriptor (`proven: true`), the
adapter ([codex.ts](../../packages/runtime/src/adapters/codex.ts)), its decoder
([codex-events.ts](../../packages/runtime/src/adapters/codex-events.ts)) and its
hook ([codex-hook.ts](../../packages/runtime/src/adapters/codex-hook.ts)) are
built, the contract suite passes on the fake `codex`, and the maintainer's
capped gate run on a real `codex` proved it (2026-11-18,
[below](#measured-on-the-gate-run)). The facts below were measured on
`codex-cli` 0.169.0 signed in with a ChatGPT account, in
[RFC-024](../../rfcs/archived/RFC-024-codex-driver.md)'s spike and that gate
run. `ork doctor` shows the driver `ok` when `codex` is signed in, a run may
take it when no `claude-code` is ready, and `ork validate` and `ork run` refuse
only a node that needs what it can't do
([drivers](./which-driver.md#the-ready-driver)). What is still not measured is
[below](#not-measured) and in [the register](../gaps/codex-limits.md).

Why: [ADR-102](../../decisions/ADR-102-codex-driver.md) (this driver),
[ADR-076](../../decisions/ADR-076-cli-drivers-only.md) (CLI drivers only),
[ADR-004](../../decisions/ADR-004-no-credentials.md) (no credentials),
[ADR-083](../../decisions/ADR-083-agent-node-types-and-driver-prefixed-models.md)
(`codex.<model>`).

## A session

One `codex exec --json` process per leg, in the node's worktree: the session
runner sets the spawn's folder and `PWD`, and Codex works in its own folder. The
brief is the message argument (with a leading space when it starts with `-`).
Codex takes nothing mid-turn here (the unproven
[`codex-app-server`](./codex-app-server.md) does), so a message sent during a
leg waits for its end: the next leg is `exec resume <id> <message>`. A fork is
`exec fork <id> <message>`, and the new `thread.started` line gives its id. A
node outside a git repository is refused by Codex itself: Ork never passes
`--skip-git-repo-check`. That refusal, and Ork's own over a user or system hooks
file (below), end the node as `invalid_node` (its setup), not as an Ork crash.

## The flags of a leg

`codexArgs` gives, in order:

```text
codex exec [resume <id> | fork <id>] --json --ignore-user-config --ignore-rules
  --dangerously-bypass-hook-trust --disable plugins --disable apps
  --disable remote_plugin -c sandbox_mode="…" [-m <model>]
  [-c model_reasoning_effort="…"] [-c developer_instructions="…"] <message>
```

then the wiring's keys: `-c mcp_servers.ork.*` and `-c hooks.PreToolUse=[…]`.

- **`-m`** only when the node names a model, as written after the `codex.`
  prefix; otherwise Codex's own default for the account runs.
- **`model_reasoning_effort`** only when the node sets an effort. Ork's `max` is
  passed as `xhigh`, Codex's highest.
- **`developer_instructions`** (Ork's whole instruction text, about 15 to 20 KB;
  Linux allows 128 KB in one argument) on a session's **first leg only**: a
  resumed or forked leg keeps its session's, and the spike showed they do not
  take on a fork.
- **Every `-c` value is TOML**: strings are JSON-escaped (a valid TOML basic
  string), arrays and inline tables are written out
  ([`tomlValue`](../../packages/runtime/src/adapters/codex-hook.ts)).
- **Never present:** `-p`, `--ephemeral`, `--trust`, `--approve-for-me`,
  `--skip-git-repo-check`, a profile, `danger-full-access` or
  `--dangerously-bypass-approvals-and-sandbox`.
- **Resume and fork** pass the sandbox, MCP and hook keys again on every leg
  (the spike showed they hold); `--disable` and the trust bypass are accepted
  there, checked on 0.169.0.

## Ork's endpoint

`kind: "flag"` wiring: `-c mcp_servers.ork.url`, `.bearer_token_env_var`
(`ORK_CODEX_MCP_TOKEN`), `.tool_timeout_sec` (the same ten minutes as
`claude-code`), `.required=true` (a start fails when Ork's server is not ready)
and `.default_tools_approval_mode="approve"` (without it every Ork tool call is
refused as needing an approval `exec` never gives). **The token is in the leg's
environment only**, under that name: never on the command line, in a file or in
an event. Codex 0.169.0 hands its whole environment to a shell it starts (the
gate run read the token from one), so the leg also passes
`-c shell_environment_policy.exclude=["ORK_CODEX_MCP_TOKEN"]`, which keeps it
out (measured again: absent). Ork's tools reach the model as `mcp__ork__<tool>`.
Codex reads no project `.mcp.json` (measured: it listed no MCP servers), so a
node's own servers are not given to it (`mcpServers: false`; `ork validate`
refuses a node that names `mcp`); giving them would mean writing each as
`-c mcp_servers.<name>.*` keys.

## What holds a node to its rules

Two walls, and the node is deny by default
([ADR-094](../../decisions/ADR-094-yolo-runs.md) for `--yolo`):

- **The sandbox** (`-c sandbox_mode`, `codexSandbox`) is the outer wall:
  `read-only` in `plan` mode; for a node whose `deny` has a bare `Edit` and a
  bare `Write` (no path in parentheses, case and spaces aside), as a `readonly`
  node's isolation denies them, whatever its `allow`, `acceptEdits` or `--yolo`
  say (a readonly node's `git status` allows are shell rules); for a node whose
  `tools.only` names no `Bash`, `Edit` or `Write` (that holds under `--yolo` and
  `acceptEdits` too: `only` caps what a node can do); and for a node whose
  `allow` has none of them (and no `--yolo`); else `workspace-write`. A
  path-scoped deny (`Edit(docs/**)`) or one of the two alone changes nothing.
  The cost: a node denied writing can't run a command that writes a file
  anywhere the sandbox guards (a test cache, temporary output), so a readonly
  reviewer that runs the tests on `codex` sees them fail where they write.
  `--yolo` gets `workspace-write`, never wider. Network stays off
  (`sandbox_workspace_write.network_access` is not set), so an `allow` naming
  `WebFetch` allows nothing. Codex asks for no approval in `exec`; its hook
  input reports `permission_mode: "bypassPermissions"`, so the sandbox and the
  hook are the only fences.
- **The hook** is the node's rules: a `PreToolUse` command hook with matcher
  `.*`, given inline by `-c hooks.PreToolUse=[…]`. `exec` runs a hook Ork wrote
  only with `--dangerously-bypass-hook-trust`, which is per invocation and saves
  no trust.

### The hook

Ork writes, per session, a private folder outside the checkout (mode 0700, files
0600, [secret-file.ts](../../packages/runtime/src/secret-file.ts)) holding
`hook.mjs`, `rules.mjs` (the node's rules as a constant, with the matcher shared
with `command-code`'s mod,
[tool-rules-source.ts](../../packages/runtime/src/tools/tool-rules-source.ts))
and `calls.jsonl`. The command is `"<node>" "<hook.mjs>"`. The folder goes when
the session's MCP wiring is released, after a failure too. The script reads
`{tool_name, tool_input}` on stdin and, to refuse, prints
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}`;
the model reads the reason. Printing nothing allows.

- **Tool names are Claude Code's**, the words a node's rules use: `Bash` is
  `Bash`, `apply_patch` is `Edit`, an MCP call is `mcp__<server>__<tool>`.
  `mcp__ork__*` always goes through. **Any other name is denied, `--yolo`
  included**, as Ork cannot say what it does.
- **`deny` and `only` are honoured**; `--yolo` allows what they don't refuse. A
  shell line is checked command by command, and a shipped read needs no rule, as
  on `command-code` ([its page](../architecture/command-code.md)). `Edit` and
  `Write` rules cover a patch; a `Read`, `Glob`, `Grep` or `WebFetch` allow has
  no Codex action and allows nothing.
- **`reading`** refuses a shell read, and a text read when it is `extract-only`,
  with the `extract` call to make ([extract](./extract-tool.md)); Codex has no
  read tool to gate. The sandbox may read outside the worktree, so a `deny` on a
  `Read`, `Glob` or `Grep` path can't hold: `ork validate` and `ork run` refuse
  such a node for this driver (capability `readDenies: false`).
- **An error in the hook refuses the call**, its own loading included.
- **A refusal leaves no item** in Codex's output (only its stderr logs it), so
  Ork shows it from the hook's own record: every call, allowed or refused, is a
  line in `calls.jsonl`, and the leg's decoder (`guarded`,
  [codex.ts](../../packages/runtime/src/adapters/codex.ts)) reads the refused
  ones (`HookFile.refusals()`) at the next output line or the leg's exit and
  emits each as a `tool.called` (the tool's name in Claude Code's words, no
  input) and a `tool.result` with `isError`, `fault: "refused"` (no new event).

### Fail closed

- **Before any model call.** The session's wiring refuses, and the node ends
  with a driver error that names the file, when `$CODEX_HOME/hooks.json`
  (default `~/.codex/hooks.json`) or `/etc/codex/hooks.json` exists: the trust
  bypass would run those hooks untrusted beside Ork's. Ork checks that the file
  exists and never reads it. A checkout's own `.codex/hooks.json` stays off, as
  an untrusted project's configuration (the spike).
- **The canary.** A leg's decoder counts the hook's calls. When a tool call
  (`command_execution`, `file_change` or `mcp_tool_call`) has finished and the
  hook was not called in that leg, the node ends `driver_crashed` ("Codex ran
  tool calls without Ork's hook … the node is stopped"). It is found after the
  fact, at the first finished tool item (`item.completed` of one of those
  three): those first calls ran inside the sandbox with no rules. The line that
  trips it carries `kill` (`Decoded.kill`,
  [adapter.ts](../../packages/runtime/src/adapter.ts)): the leg runner yields
  the end, then stops the process at once as `ork stop` does (SIGINT, then the
  leg's usual kill on its way out) and reads nothing after, so Codex runs no
  further unguarded and no tool event follows the end. The decoder also drops
  any line after the trip, and gives no second end at the exit. No event type is
  added: the end is the `session.finished` it always was.

## Output, usage and ends

[codex-events.ts](../../packages/runtime/src/adapters/codex-events.ts) reads one
JSON object a line: `thread.started` (the session id), `item.started` and
`item.completed` for `agent_message`, `command_execution`, `file_change` and
`mcp_tool_call`, then `turn.completed` with `usage`, or `turn.failed`. The trust
bypass's warning ("`--dangerously-bypass-hook-trust` is enabled. Enabled hooks
may run without review for this invocation.") comes twice a leg as an
`item.completed` whose item is of type `error` (measured), and the decoder drops
it. A top-level `error` line may carry a warning too, so it ends nothing alone,
even on exit 0: only a failed turn, or a non-zero exit whose first
provider-classified `error` sets the end; the bypass's words are kept out of the
end. There is no result line: the process's exit ends the leg.

The descriptors of `codex`, `open-code` and `command-code` live in
[cli-drivers.ts](../../packages/integrations/src/cli-drivers.ts), which the
integrations entry point re-exports whole (`export *`), so it publishes all
three descriptors, not only `codex`.

- **Usage is tokens only** (`price: false`, `costUsd` 0). Per turn:
  `output_tokens` is output, `cached_input_tokens` cache read,
  `cache_write_input_tokens` cache write, and input is `input_tokens` minus the
  cached part (floored at 0; `input_tokens` includes it, measured), one `turns`
  per turn. Two legs add as one. Usage comes once, at a turn's end, so
  `budgetTokens` stops a session between legs
  ([session ends](./session-ends.md#the-token-cap)); a node with only
  `budgetUsd` is warned. The context (`contextTokens`) stays unset, a limit: a
  turn's `input_tokens` may sum its requests (not measured).
- **Ends.** `turn.failed` and `error` text go through the shared provider
  classifier: "The '<model>' model is not supported when using Codex with a
  ChatGPT account." ends `model_unavailable`. Exit 130 is `interrupted`; exit 0
  with no failure and no report is `no_report`.
- **No `hold`:** Codex's hook decides locally only, so `ork pause` and
  `ork stop` land at a leg's end and `heavy` slots are not taken for its shell
  calls.
- **The report** goes by Ork's `report` tool (`reportSchema: false`), checked
  against the node's schema as on the other drivers
  ([node report](./node-report.md)): the API refuses Ork's report schemas under
  `--output-schema` (measured).

## What a session loads

Ork gives `--ignore-user-config` and `--ignore-rules`, and turns off plugins,
apps and remote plugins (`--disable`); memories are off by default. Codex reads
`AGENTS.md`, `.agents/skills` and `.codex/agents` of the checkout. Its bundled
skills and your own (`~/.agents/skills`, `~/.codex/skills`) stay visible by name
and description, and a session is kept in `$CODEX_HOME/sessions`. A new session
with plugins off began at about 19,000 input tokens.

## The doctor check

`codex --version`: missing is `skip`, with a hint to install it; older than
`MIN_CODEX_VERSION` (0.169.0, the version proven) is `warn`. Else
`codex login status` runs, and only its **exit status** is read: 0 is `ok`
("logged in"), else `warn` with "sign in with `codex login`"; Ork never reads
`auth.json`. With more than one driver ready a run takes `claude-code` first
(`PREFERRED_DRIVER`), so a signed-in `codex` never displaces it.
`OPENAI_API_KEY` is not counted as a login: Codex reading it was never measured.

## Measured on the gate run

On 2026-11-18, `codex-cli` 0.169.0 with a ChatGPT account, the default model at
effort `low`, under token caps (Codex reports no dollars):

- **Ork's tools reach the model**: `extract`, `report`, `wait_for_messages` and
  `read_inbox` all worked, also when Codex called them from its own JavaScript
  `exec` cell ("code mode": `tools.exec_command(…)`, `tools.mcp__ork__…`). One
  session used plain shell items, another code mode.
- **The hook refuses**: a `touch made.txt` the node did not allow was blocked
  ("Command blocked by PreToolUse hook: Ork: Bash is not allowed for this node.
  Do not retry it. Command: touch made.txt"), a piped `printenv … | wc -c | awk`
  line was refused command by command, and Codex's own `clock.sleep` was refused
  as a tool Ork does not know.
- **The token** was in the agent's shell before
  `shell_environment_policy.exclude`; with it, absent.
- **A resumed leg** (a message sent with `ork chat -m` mid-leg, delivered at its
  end by `exec resume`) kept Ork's tools and the hook: it ran `extract`, and the
  canary did not trip.
- **`input_tokens` includes the cached part**: Codex's own record was input
  210,767, cached 178,816, and its total input plus output.
- **A `readonly` node got the read-only sandbox**: an allowed `touch ro.txt`
  failed with "Operation not permitted".
- **`--output-schema`** refused all 14 report schemas of this repository's
  workflows: "'schema.required' is required to include every key in properties"
  (the API's strict mode; Ork's reports have optional fields and an `artifacts`
  map). So `reportSchema` stays `false`.
- **Outside a git repository** Codex exits 1 with "Not inside a trusted
  directory and --skip-git-repo-check was not specified.", which ends the node
  `invalid_node`. Ork's projects are git repositories, so the flag stays off.
- **A project `.mcp.json`** is not read: Codex listed no MCP servers.
- **Found**: a message sent mid-leg is held for the next leg, so `read_inbox`
  and `wait_for_messages` say "no message" while one waits; a refused call shows
  in `ork logs` with an empty input; a call from code mode is logged as the
  inner tool (L451 to L453 in [the register](../gaps/codex-limits.md)).

## Not measured

Each is in [the register](../gaps/codex-limits.md): auth, rate-limit and credit
error shapes (only text matching is used), the paths `workspace-write` allows
besides the folder, whether a hook can write the calls file, Codex's own web
search (no key found to turn it off on 0.169.0), and holding a paused call from
a hook. The tests that pin the behavior above:
[codex.test.ts](../../packages/runtime/test/codex.test.ts),
[codex-hook.test.ts](../../packages/runtime/test/codex-hook.test.ts), and the
contract suite's entry for the fake `codex`
([entries.ts](../../packages/runtime/test/contract/entries.ts)): it reports
every cause of `TOOL_ENDS` but `turn_limit` (`cannot`: no key caps Codex's
turns) and keeps "not supported when using Codex" in the model-refused end's
detail (`modelError`).
