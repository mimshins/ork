# The `omp` driver

_Part of [Runtime: the agent drivers](../runtime.md)._

Status: **Built, not yet proven** (gate run pending): the `omp` descriptor
(`proven: false`), the adapter
([omp.ts](../../packages/runtime/src/adapters/omp.ts)), its rpc codec
([omp-rpc.ts](../../packages/runtime/src/adapters/omp-rpc.ts)), its decoder
([omp-events.ts](../../packages/runtime/src/adapters/omp-events.ts)), guard
([omp-guard.ts](../../packages/runtime/src/adapters/omp-guard.ts)), session
files ([omp-config.ts](../../packages/runtime/src/adapters/omp-config.ts)) and
spend ledger
([omp-ledger.ts](../../packages/runtime/src/adapters/omp-ledger.ts)) are built,
and the contract suite passes on a fake `omp --mode rpc` that replays the frames
[RFC-027](../../rfcs/active/RFC-027-long-lived-protocol-drivers.md)'s spike
captured. Until a capped gate run on a real `omp` passes, `ork validate` and
`ork run` refuse a node that names it ("not yet proven on a real session"),
`ork doctor` shows it `skip`, and it never counts as ready
([drivers](./which-driver.md#the-ready-driver)). The facts in these pages come
from [RFC-026](../../rfcs/archived/RFC-026-omp-driver.md)'s spike and capture
legs and a free hand check, all on `omp` 18.22.2 (oh-my-pi); the hand check used
a stand-in model server and never touched a real login. What is not measured is
[listed](./omp-output.md#not-measured) and in
[omp's limits](../gaps/omp-limits.md).

Why: [ADR-105](../../decisions/ADR-105-omp-driver.md) (this driver),
[ADR-108](../../decisions/ADR-108-duplex-session-client.md) (the rpc path),
[RFC-027](../../rfcs/active/RFC-027-long-lived-protocol-drivers.md) (the two-way
client and the rpc path), [ADR-076](../../decisions/ADR-076-cli-drivers-only.md)
(CLI drivers only), [ADR-004](../../decisions/ADR-004-no-credentials.md) (no
credentials), [ADR-041](../../decisions/ADR-041-pause-continue-stop.md) (pause,
continue and stop), [ADR-046](../../decisions/ADR-046-usage-ledger-and-prune.md)
(a resumed session's total),
[ADR-083](../../decisions/ADR-083-agent-node-types-and-driver-prefixed-models.md)
(`omp.<model>`) and
[ADR-103](../../decisions/ADR-103-fresh-session-for-the-next-task.md)
(`contextTokens`). The shape, and the options weighed, are in the RFC.

## A session

One `omp --mode rpc` process per leg, in the node's worktree, driven by the
[two-way client](./duplex-client.md) through the `omp-rpc` codec. The brief is a
`prompt` frame, written once `omp` says it is `ready`, not an argument. A
message or answer sent during a leg is a `steer` frame: it reaches the model
before the turn ends (a call that is running finishes first). A paused node's
long pause ends the leg and the next one is `--resume <id>`, which sends a
message asking the model to make the held call again, never the brief a second
time (any other resume, such as a late message, a retry or `ork resume`, sends
the node's own prompt, as on every driver); a leader's question fork is
`--fork <id>`, and its `session` carries the fork's id (and `parentSession`).
The user's own `omp` login decides the provider, with their `OMP_PROFILE` or
`PI_CODING_AGENT_DIR` when set: Ork sets neither and passes no `--api-key`.
`--model` carries the node's model exactly as written after `omp.` (a fuzzy
name, `provider/model`, or a role the user configured), and is absent when the
node names none, so `omp`'s own default runs.

The descriptor (`omp` in
[cli-drivers.ts](../../packages/integrations/src/cli-drivers.ts)) has
`questions`, `price`, `readDenies`, `permissionPrompt` and `midTurnMessages` all
`true`, and `reportSchema`, `turnLimit`, `mcpServers` and `subagents` all
`false`: `ork validate` refuses a node that sets `maxTurns`, names `mcp` servers
or owns an `agent.subagent` for it. The adapter's `permissions.kind` is
`callback`: Ork answers the tool's approval asks
([approvals](./omp-rules.md#approvals-over-rpc)). `proven` stays `false`.

## The flags of a leg

`ompArgs` gives, in order:

```text
omp --mode rpc --no-skills --no-rules --no-title --no-lsp --no-pty
  --no-prewalk --no-judge --no-spotlight --offline [--model <model>]
  [--resume <id> | --fork <id>] --tools <list> --thinking <level>
  [--append-system-prompt <text>]
```

then the wiring's: `--session-dir`, `--config`, `--trusted-extension`,
`--plugin-dir` and, with a `budgetUsd`, `--max-cost`. There is no `-p`, no
`--mode json` and no brief argument. `--no-ui` is gone too: in `rpc` mode `omp`
asks a tool missing from the approval map through its UI, and Ork answers
([approvals](./omp-rules.md#approvals-over-rpc)); a UI request of a method Ork
does not know gets no answer. The set of tools that can ask is still the set the
guard and the overlay name.

- **`--thinking`** on every leg: the node's `effort` as written (`low`,
  `medium`, `high`, `xhigh`, `max`), and `medium` when it sets none. Never
  `auto`: a side request would choose the level.
- **`--append-system-prompt`** (Ork's instructions) on **every leg**, first,
  resumed or forked: the capture legs showed neither keeps them.
- **`--tools`** lists only built-ins among `read, edit, write, bash, grep, glob`
  the node's rules can allow
  ([rules](./omp-rules.md#what-holds-a-node-to-its-rules)); never `eval` or
  `task`.
- **Never present:** the endpoint's token, `-e`, `--extension`, `--hook`,
  `--yolo`, `--plan-yolo`, `--advisor`, `--api-key`, `--profile`,
  `--no-session`, `--no-context-files`, `--no-tools`, `-p`, `--mode json`,
  `--no-ui` or an `--approval-mode` of `yolo`. `-e` beside `--trusted-extension`
  is exit 2 (measured).
- The environment adds `OMP_MCP_REQUIRE_READY=1` (a start fails when Ork's
  server is not ready: `MCP servers not ready`) and `OMP_MCP_TIMEOUT_MS=0`
  (`delegate` and `ask_user` wait as long as they need). The rest is the user's.
- Two flags are undocumented in `omp --help` (`--trusted-extension`, `--fork`);
  `--plugin-dir` is documented only in its CLI reference. A release that drops
  one ends the leg at exit 2 ("unknown flag") before any model call.

## Contents

- [Ork's endpoint and the private folder](./omp-wiring.md)
  - Ork's endpoint and the private folder
  - What a session loads
- [Rules, the guard and the hold](./omp-rules.md)
  - What holds a node to its rules
  - Pausing and `heavy` slots
- [Output, usage, budgets and the doctor](./omp-output.md)
  - Output, usage and ends
  - Budgets
  - The doctor check
  - Not measured
