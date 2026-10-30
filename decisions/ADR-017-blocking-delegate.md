# ADR-017 — Leaders delegate with a blocking tool call

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** engine / ownership
- **RFC:** waived — the author chose among the options below directly

## Context

A `claude.leader` hands work to its declared children and gets their reports
back ([ADR-008](./ADR-008-ownership-hierarchy.md)). The tool it uses for that
could wait for the children, or return at once and deliver their reports later.

## Decision

`delegate(tasks: { child, brief }[])` **blocks** until every child in the call
has reported, and returns their reports. Children in one call run in parallel
(within `limits.concurrency`). `spawn_worker(tasks: { template, brief }[])`
works the same way for new instances of a child worker, up to `maxWorkers`; it
takes a list too, so instances can run in parallel. A waiting leader lends its
session slot to its children. Built in M1c
([specs/scheduler.md](../specs/scheduler.md#delegation),
[specs/messaging.md](../specs/messaging.md)).

## Options considered

- **Blocking tool** — chosen.
- **Asynchronous delegate**, with reports arriving later as messages through
  `Session.send`. More flexible (the leader keeps working meanwhile), but needs
  the message bus (M1d) and makes a leader's turn order harder to follow.

## Rationale

A blocking call matches Claude Code's own Task tool, so models already use it
well; it works before the message bus exists; and a run's transcript reads in
order.

## Consequences

- A long child keeps the leader's tool call open. The CLI ends an HTTP MCP
  request after 60 seconds and a silent call after 5 minutes, so the CLI driver
  gives Ork's server a per-server `timeout` of 24 hours (under
  `MCP_TOOL_TIMEOUT`, about 28 hours by default); the SDK's in-process server
  has no such limit ([specs/runtime.md](../specs/runtime.md)).
- An asynchronous form can be added later beside it, once the bus exists.
