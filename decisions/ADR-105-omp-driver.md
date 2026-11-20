# ADR-105 — The `omp` driver: oh-my-pi's `omp` CLI as the fifth driver

- **Status:** Accepted; amended by [ADR-108](./ADR-108-duplex-session-client.md)
  (the process shape, mid-turn messages, approvals and the long pause) and by
  [ADR-113](./ADR-113-omp-host-tools.md) (Ork's tools: host tools, no plugin)
- **Date:** 2026-11-19
- **Topic:** runtime
- **RFC:** [RFC-026](../rfcs/archived/RFC-026-omp-driver.md)

## Context

[ADR-076](./ADR-076-cli-drivers-only.md) made every driver a tool's CLI behind
one session runner, with a descriptor of declared capabilities.
[ADR-102](./ADR-102-codex-driver.md) added `codex` as the fourth. `omp`, the CLI
of the oh-my-pi coding agent, reaches many model providers through the user's
own logins ([ADR-004](./ADR-004-no-credentials.md)). `omp -p --mode json` runs
one session a process, asks for no approval Ork can answer in print mode, and
has no sandbox, so a node's rules need walls Ork builds. RFC-026's spike,
capture legs and a free hand check measured the flags, the line shapes, the hold
and the cost accounting on `omp` 18.22.2.

## Decision

All by the maintainer, 2026-11-19. None is hard to reverse beyond what the
adapter's tests and the gate run already cover.

- **One process per leg.** Each leg is `omp -p --mode json` in the node's
  worktree. A later message or answer waits for the leg's end and runs
  `--resume <id>`; a leader's question fork runs `--fork <id>`.
  `midTurnMessages` and `permissionPrompt` are `false`. The long-lived
  `omp --mode rpc` shape, mid-turn messages and approvals Ork answers go to a
  later RFC, shared with `codex app-server`. (Amended by
  [ADR-108](./ADR-108-duplex-session-client.md): `omp` now runs `omp --mode rpc`
  on the two-way client, with both flags `true`.)
- **Ork's tools through a private plugin folder.** `--plugin-dir` carries Ork's
  MCP server, with `tools.xdev: false`. The bearer token is a literal in the
  plugin's `.mcp.json` and in a hold file, each mode 0600, in a private folder
  (0700, outside the checkout) removed when the session ends. It is not in the
  arguments or the leg's environment. (Superseded by
  [ADR-113](./ADR-113-omp-host-tools.md): Ork's tools are host tools over the
  rpc pipe; no plugin, no `.mcp.json`, the token in the hold file only.)
- **A guard Ork writes, with `omp`'s approval settings behind it.** The guard is
  the only extension (`--trusted-extension`), a `tool_call` handler that applies
  the node's rules with the shared matcher; an overlay (`--config`) sets
  `approvalMode: always-ask` and allows or denies each tool by name, from the
  same list as `--tools`. `eval` and `task` are never offered. A guard that does
  not load, a missing overlay or an Ork server that is down ends the leg before
  a model request (the server-down end went with the plugin: ADR-113).
  `readDenies` is `true`, held by `--tools` first: a path-scoped `Read`, `Grep`
  or `Glob` deny offers none of the read tools.
- **Edits outside the worktree are refused.** The guard refuses an `edit` or
  `write` whose real path is outside the node's folder, `--yolo` included,
  because `omp` has no sandbox.
- **The user's own setup.** The login is the user's own `omp` login, or the
  profile their `OMP_PROFILE` or `PI_CODING_AGENT_DIR` names; Ork passes no
  `--api-key` or `--profile`. Every leg passes Ork's instructions with
  `--append-system-prompt` (a resumed leg does not keep them) and `--thinking`:
  the node's `effort`, and `medium` when it sets none.
- **A paused node's calls are held, and `heavy` slots taken, in the first
  build.** The guard asks Ork's hold endpoint before each call and waits, in the
  same leg, until the node continues; a pause past the window (60 minutes, one
  constant) refuses the call with a request to make it again, which waits again.
  The guard frees a `heavy` slot after the call through `tool_result`.
  `ork stop` on a held call writes a marker the guard checks first, so the call
  does not run.
- **Dollars and tokens.** `price: true`. `--max-cost` counts the whole session,
  so Ork passes the session's spend so far, from a small ledger of its own
  (`~/.ork/omp/spent/`), plus the node's `budgetUsd`; a resumed session reports
  its total, as `claude-code` does
  ([ADR-046](./ADR-046-usage-ledger-and-prune.md)). `contextTokens` is the last
  request's prompt ([ADR-103](./ADR-103-fresh-session-for-the-next-task.md)).
- **Where Ork keeps `omp`'s files.** `~/.ork/omp/sessions/` (0700) for the
  session files and `~/.ork/omp/spent/` for the ledger. Nothing prunes either; a
  limit.
- **The doctor.** `ork doctor` runs `omp --version` and `omp models --json`, and
  shows the count of models; a node's own model is checked in a follow-up.
- **Names.** Id `omp`; a node's `model: omp.<model>` goes to `--model` as
  written; a node with no model runs `omp`'s default; `MIN_OMP_VERSION` is
  18.22.2. The model `omp` resolved is not recorded in the first build; a limit.
- **`proven: false` first.** `ork doctor` shows `skip`, `readyDriver` never
  takes it, and `ork validate` and `ork run` refuse a node that names it, until
  a capped gate run on a real `omp` sets `proven: true`.
- **The public pages name all five drivers,** each with whether it is proven,
  and the npm description and keywords do too. The GitHub repository's
  description and topics are the maintainer's to change.

The RFC was accepted as written; no waiver. Contract:
[the `omp` driver](../specs/runtime/omp.md).

## Options considered

Weighed in RFC-026: a long-lived `omp --mode rpc` process or one process a leg
(chosen); Ork's tools through a plugin folder, a hook-registered tool or an
environment variable (a variable reaches the agent's shell); the guard alone or
with approval settings behind it (both, chosen); a clean session by flags or a
dedicated profile (flags); dollars from `omp`'s per-request cost or tokens only.

## Rationale

`omp` offers an extension hook that can refuse a call and hold it, and approval
settings that refuse a tool by name, which together keep a node inside its rules
without a sandbox. The plugin folder is the one way measured to give a leg Ork's
MCP server and a fail-closed guard together, with the token in a file Ork
removes, not in an environment variable. One process a leg needs no change to
the session runner and reuses the `codex` shape. A ledger of Ork's own makes a
resumed session's budget the node's own, though `omp`'s cap counts the whole
session.

## Consequences

- Extends ADR-076's driver list and ADR-102's capabilities with a fifth driver;
  no port and no shared type changes ([runtime spec](../specs/runtime.md)).
- A long pause costs one model request per window, and a true deferral (end the
  leg, resume on continue) needs a session-runner change; a follow-up.
- Gaps recorded in [the register](../specs/gaps/omp-limits.md): no mid-turn
  message, no sandbox, the guard's files and the token readable by the user's
  processes, catalogue prices and unpriced models, session and ledger files
  never pruned, the resolved model not recorded, errors read by text.
- Follow-ups after merge: the gate run that sets `proven` and confirms the hold
  window, checking a node's own `omp.<provider>/<model>` before a run, and an
  RFC for the long-lived shape.
