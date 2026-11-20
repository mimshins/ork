# ADR-115 — A `codex-app-server` driver beside `codex`, on the two-way client

- **Status:** Accepted
- **Date:** 2026-11-21
- **Topic:** runtime
- **RFC:** [RFC-027](../rfcs/archived/RFC-027-long-lived-protocol-drivers.md)
  (Accepted, option A; closed by this build)
- **Amends:** [ADR-108](./ADR-108-duplex-session-client.md)

## Context

[ADR-102](./ADR-102-codex-driver.md) ran `codex exec` once per leg, so a message
waited for the leg's end, a stop landed late and Codex asked Ork nothing (G39).
[ADR-108](./ADR-108-duplex-session-client.md) built a two-way client in the
runner with a codec for `omp`, and left the `codex app-server` codec to a later
plan, with the question whether it replaces `codex exec` or is a new driver id.
`codex app-server` speaks JSON-RPC 2.0 over stdio, is experimental, and was not
run while this was built: the codec's names come from
`codex app-server generate-json-schema` of codex-cli 0.169.0.

## Decision

All by the maintainer, 2026-11-21 (the plan for this build; RFC-027's option A
2026-11-20). The driver id is hard to reverse, as a workflow-format value.

- **A new driver id, `codex-app-server`;** `codex` (`codex exec`) is unchanged
  and stays proven. The protocol is experimental and unrun, so it is opt-in. The
  `driver` enum gains the value (additive: no `schemaVersion` bump, as when
  `omp` was added), and a model may be written `codex-app-server.<model>`. Its
  descriptor is `proven: false`, so `ork validate` and `ork run` refuse it by
  name and `ork doctor` shows it `skip` until a capped gate run passes; its
  minimum version and its doctor check (the `codex` binary,
  `codex login status`) are `codex`'s.
- **Capabilities.** `permissionPrompt: true` and `midTurnMessages: true` (a
  `turn/steer`: before the turn ends, not at once, as on `omp`),
  `questions: true`; `price`, `reportSchema`, `turnLimit`, `mcpServers`,
  `subagents` and `readDenies` are `false` for `codex`'s reasons; `permissions`
  is `{ kind: "callback", denyByDefault: true }`. No `hold` hook, so the driver
  never defers and a pause lands at the turn's end (G40).
- **Approvals Ork answers, once, in two words.** A command or file-change
  request becomes an `ask` through `ports.human.permit`; the answer is `accept`
  or `decline`, never `acceptForSession`, never an execpolicy or network
  amendment. The thread request fixes `approvalPolicy: "on-request"`
  (`"untrusted"` is in the schema but the binary refuses it) and
  `approvalsReviewer: "user"`, so a user config cannot route an approval to a
  model. Every other server request is answered at once with a refusal (a failed
  host-tool call, a decline, an empty grant, an error), never an allow, so no
  turn waits on Ork.
- **The node's rules are never weaker than on `codex`, and fail closed.** The
  sandbox, Ork's MCP server with its token in the process environment only, and
  the per-session PreToolUse hook are shared with `codex`. `app-server` has no
  `--dangerously-bypass-hook-trust`, so the hook's trust is a thread `config`
  key (`bypass_hook_trust`, guessed). A user or system `hooks.json` refuses the
  session before it starts; after `initialize`, a `hooks/list` fence ends the
  leg before any thread unless Ork's `preToolUse` hook is the only enabled hook;
  a tool call that finished with no growth in the hook's calls file ends the leg
  `driver_crashed` with `HOOK_DID_NOT_RUN`. If the hook cannot run, the node
  does not run. Never `--dangerously-bypass-approvals-and-sandbox` or
  `danger-full-access`.
- **The codec contract grows by two optional parts,** which `omp` does not use:
  `readyAtSpawn` (open at spawn, for a tool that waits for Ork's first request)
  and `waitsForTurn` (a message is held until a frame the codec marks `turn`,
  since `turn/steer` names the running turn). The shared Codex pieces moved to
  `codex-shared.ts`; `codex`'s behavior did not change.
- **No host tools yet.** An `item/tool/call` is answered as a failed call, never
  served; Ork's tools reach Codex through its MCP server. Host tools on either
  codec are a later change.

Contract: [the `codex-app-server` driver](../specs/runtime/codex-app-server.md),
[the two-way client](../specs/runtime/duplex-client.md) and
[which driver](../specs/runtime/which-driver.md).

## Options considered

Replace `codex exec` with the new protocol (ruled out: an experimental, unrun
wire should not displace a proven driver); a paid spike first, to measure the
shapes (ruled out by the maintainer: the codec is built from the generated
schema, and what only a run can measure is a recorded limit); the Agent Client
Protocol as the one wire (ruled out by RFC-027, option D). For the trust of the
hook: carry it as a thread `config` key (chosen, guessed) or refuse every node
that has rules (a driver no rule-bound node could use).

## Rationale

A second id keeps the proven path untouched while the new one earns its place
through a gate run, as `omp` did, and gives the workflow a way to ask for a
mid-turn message and a real interrupt without a flag on `codex`. Approvals that
can only be accepted or declined once keep Ork's own tool rules the authority:
Codex's session-wide grants would let a later call skip them. Failing the node
when its hook cannot be installed or seen costs a failed start, where weakening
the rules would cost a silent hole.

## Consequences

- Six drivers, two of them unproven. Every list of ids gains the sixth (the
  schemas, the CLI help and completion, the server's feedback map).
- The wire is unmeasured, so
  [the register](../specs/gaps/codex-app-server-limits.md) holds L548 to L559:
  the shapes, the user's config and rules still loading (weaker than `codex`),
  the guessed hook trust key, the fence's reach, a steer that may wait for a
  running command, no host tools, the refusal shown twice, the usage baseline,
  error codes and id formats, a file-change ask built from a remembered item,
  and the handshake's later replies not bounded in time.
- G39 closes: `codex` still takes no message mid-turn by design, and
  `codex-app-server` does. G40 is re-read: a stop on the new driver is a real
  interrupt, a pause is not.
- RFC-027 is fully built and closes. Follow-ups: a capped gate run that, if it
  passes, sets `proven`, and host tools over the pipe on both codecs.
