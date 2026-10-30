# ADR-027 — Claims are advisory, by path, and released when a node ends

- **Status:** Accepted
- **Date:** 2026-10-31
- **Topic:** engine / claims
- **RFC:** none — `claim(resource)` and `release(resource)` were specified
  ([specs/messaging.md](../specs/messaging.md)); this records how they behave,
  and every choice below can change without touching a workflow file

## Context

Nodes that write can run at the same time: two workers under a leader, copies
from `spawn_worker`, parallel branches of a workflow. With `isolation: shared`
or `--in-place` they share one checkout and can overwrite each other; in
worktrees they meet later as merge conflicts. The M1d task spec asked that a
second worker claiming a path be told who holds it.

## Decision

1. **One registry per run** in `core/`
   ([claims.ts](../packages/core/src/run/claims.ts)); each leader and worker
   gets its `Claims` through its session's ports, beside its `Mailbox`.
2. **Advisory:** a claim steers the agents; it does not lock files or stop a
   tool call. Agents are told to claim before they edit, in the tool
   descriptions and one line of Ork's instructions.
3. **Paths from the project root:** a claim names a path or anything else shared
   (`db:migrations`). An absolute path inside the node's checkout is made
   relative to it, so nodes in different worktrees name the same file the same
   way. A folder covers everything under it; `.` is the whole project.
4. **Refuse, do not wait:** a claim overlapping another node's returns at once
   with who holds what. When that claim is released, the refused node's live
   session gets a one-line notice through the message bus, so it never polls.
5. **Released when the node ends,** however it ends, besides `release`; nothing
   survives the run, and a resumed run starts with none.
6. **Only where it matters:** the tools go to leaders and workers that are not
   `readonly`, when another such node (or a copy a leader may spawn) exists.

## Options considered

- **Locks enforced by Ork** (refusing `Edit` and `Write` on a claimed path):
  needs every tool call's path parsed for both drivers, and still misses `Bash`.
  Rejected for now; claims as advice cover the cases the spec named.
- **A blocking `claim` that waits for the holder:** simpler for the agent, but
  two nodes waiting on each other deadlock a run. Rejected; the notice gives the
  same result without the wait.
- **Exact names only, no folders:** simpler, but a node working on `src/auth/`
  would not see a claim on one file in it. Rejected.
- **Tools for every Claude node:** costs tokens in sessions that never share a
  file with anyone. Rejected.

## Consequences

- `claim.taken`, `claim.refused` and `claim.released` are run events; `ork logs`
  shows them.
- A node that does not claim is not stopped; a stale claim cannot outlive its
  node.
- Enforcing claims later adds a check on tool calls; the registry stays the
  same.
- Specified in [specs/messaging.md](../specs/messaging.md#claims).
