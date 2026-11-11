# RFC-016 — A lock that orders integration into a branch

- **Status:** Accepted
- **Date:** 2026-11-11
- **Supersedes:** —
- **Superseded by:** —

## Context

The maintainer works `se-backend` style: several GitHub issues at once, each
built by an agent in its own worktree, all integrated into one named branch and
one PR that closes them. Runs already run in parallel without conflicts, since
each has its own worktree and branch ([worktrees](../../specs/worktrees.md)).
What is missing is the integration step.

[`build.ork.yaml`'s `publish`](../../.ork/workflows/build.ork.yaml) is one
`tool.shell` node: commit, `fetch origin <base>`, `rebase FETCH_HEAD`, run
`pnpm run check`, `push --no-verify origin HEAD:refs/heads/<branch>`, then open
or update the PR. Between its `fetch` and its `push` the branch's tip can move.
Two runs publishing to the same branch race, and the second push is rejected. On
a rebase conflict the node runs `rebase --abort` and exits, so the run stops for
the maintainer. The check sits between the fetch and the push, so the window is
as long as a full check.

The wanted behaviour (the brief's section 6): one run at a time integrates into
a branch, from fetch through push, so the next one rebases onto the last one's
result. The lock must be held while an agent resolves a rebase conflict and the
check runs again, which are separate nodes. It must work for one run over many
issues (a `forEach`) and for separate runs onto the same branch, show who holds
it and who waits, and recover from a holder that died.

Precedents in the code:

- The Command Code lease ([`lease.ts`](../../packages/runtime/src/lease.ts),
  [`lease-ledger.ts`](../../packages/runtime/src/lease-ledger.ts)): a record
  made with a hard link, atomic and failing if it exists; a record whose pid is
  gone is swept; `ork doctor` lists and clears stale ones
  ([`lease-checks.ts`](../../packages/cli/src/doctor/lease-checks.ts)); the wait
  is announced through the `session.waiting` event
  ([ADR-075](../../decisions/ADR-075-session-waiting-event.md)).
- The machine-wide slot ledger
  ([`slot-ledger.ts`](../../packages/core/src/machine/slot-ledger.ts),
  [ADR-080](../../decisions/ADR-080-machine-slots-and-lower-priority.md)): the
  same mechanism plus tickets, so waiters are served first come, first served;
  `slot.waiting` and `slot.taken` events; the node's, its owners' and the run's
  clocks stand still while it waits; `ork ps`, `ork logs`, `ork tree` and the UI
  show it. It guards one tool command, not a span of nodes, and `ork doctor`
  does not sweep it yet ([L259](../../specs/gaps/machine-limits.md)).
- `forEach` ([RFC-013](../archived/RFC-013-for-each.md)) already runs a node
  once per item, which is how one run builds many issues.

The decision is how a workflow asks for that lock. The ledger, the stale
takeover and the doctor sweep are the same whichever option is chosen.

## Options

### Option A — a node field `lock: <name>`

A node names a lock; the run holds it from the first node that names it to the
last node in the run that names it, or to the run's end. The name may carry
`{{inputs.branch}}`, so the lock is per branch. Any workflow, the shipped
`issues` one, `build`, or a project's own, takes it the same way.

- **Pros:**
  - Held throughout, across nodes: fetch, rebase, the resolver agent, the check
    and the push can be separate nodes under one hold.
  - General: it orders any shared resource (a branch, a deploy target), not only
    git. A project's non-git publish can use it.
  - Fits one run over many issues and separate runs alike, since both name the
    same lock.
  - Reuses the slot ledger's tickets, events and clock rule, so the wait is
    already a shown state.
- **Cons:**
  - A workflow-format change: a new optional field on the nodes that run one
    thing. It needs no `schemaVersion` change, but it touches the Zod model, the
    JSON Schema, the compiler and the builder.
  - The scheduler must own a hold that spans nodes and release it on every end
    of the run: success, failure, stop, a decision that waits, a crash. That is
    the hardest part and the main source of risk.
  - A general lock invites misuse: a lock nobody releases early, or two locks
    taken in different orders by different workflows (a deadlock). The format
    must keep to one lock name per node, or the walk must reject cycles.

### Option B — an integration node type, `git.integrate`

One node locks, fetches, rebases and pushes. A conflict is its output, routed to
a resolver node and back, with the lock held between its calls in one run.

- **Pros:**
  - Narrower: the lock is an implementation detail of one node, with no general
    lock in the format.
  - Git behaviour (fetch, rebase, abort, push) is one tested adapter instead of
    shell in every workflow's `publish`.
- **Cons:**
  - Still needs the hold between the node's calls (the conflict loop), so the
    scheduler change of option A comes back in a private form.
  - No general lock: a project that integrates another way (a squash, a
    different host, a non-git target) cannot use it, and a second lock need
    means a second node type.
  - A new built-in node type, and the whole of `publish` (commit, check, PR)
    still has to be placed around it.

### Option C — a CLI lease, `ork lease take|release <name>`

Tool nodes' scripts take and release the lock.

- **Pros:**
  - No format change and no scheduler change; smallest to build; any script can
    use it.
- **Cons:**
  - A lock held across nodes is released by the workflow. A crash, a stop or a
    resume between nodes leaves it to the stale sweep, which only notices a dead
    process, and the `ork` process of a stopped but resumable run is gone.
  - The wait is a shell command blocking. Unless the command emits events it is
    not a run state, so `ork ps` and the UI cannot show it, and the node's clock
    keeps running (ADR-080 stands the clocks still).
  - Correctness depends on every workflow remembering to release on every path;
    the walk (RFC-009) cannot check it.

### Option D — a lock around one tool command only

`lock:` on a tool node holds the lock only while that command runs, as the heavy
slot does.

- **Pros:**
  - The smallest change, with no hold across nodes: it is the slot mechanism
    with a name.
- **Cons:**
  - On a conflict the node releases the lock, the resolver works without it, and
    the retry rebases onto a tip that may have moved again and conflict again; a
    busy branch can starve a resolver.
  - Rules out the brief's "the lock is held throughout", and a check that passed
    on one tip can precede a push onto another.
  - Fetch through push would have to stay one tool node, which keeps the
    resolver out of the middle.

## Decision

**Option A: a node field `lock: <name>`**, chosen by the maintainer.

It is the only option that is both held from fetch to push across the nodes a
conflict needs and general enough for `issues`, `build` and a project's own
workflows to share. B needs the same cross-node hold without the generality, C
leaves release and visibility to each script, and D cannot hold the lock while a
resolver works. The cost accepted is a format change and a scheduler hold.

## Consequences

- **Ledger.** It lives in the project's runs folder beside the Command Code
  leases, as records of a run id, a node id and a pid only. Takeover and the
  `ork doctor` sweep follow the lease ledger. The sweep should cover the slot
  ledger too, which closes [L259](../../specs/gaps/machine-limits.md).
- **Waiting.** It reuses the wait events and the clock rule of the slots, with
  the holder named, so `ork ps`, `ork logs`, `ork tree` and `ork ui` show
  "waiting for the branch".
- **Format.** A new optional field, with its Zod schema, `workflow.schema.json`
  (regenerated; a test fails when stale), the builder and the format spec
  ([node types](../../specs/workflow-format/node-types.md)). No `schemaVersion`
  change.
- **Scheduler.** The hold is released on every end of the run or of the node
  that closes it. It is not released while the run waits on a decision, so a
  maintainer question about a conflict keeps the lock; the plan must say how a
  stopped or paused run resumes holding it.
- **Specs and decisions.** A spec for it: [worktrees](../../specs/worktrees.md)
  or a new `specs/integration.md`. An ADR on shipping, then
  `pnpm rfc:close RFC-016`.
- **Follow-up work in the brief.** The resolver and its behaviour question, the
  shipped `issues` workflow, and `build`'s `publish` moved onto the lock and the
  conflict step are separate tasks of the plan, not decided here.

## Resolved questions

Answered by the maintainer, 2026-11-11:

- **Wait limit.** The clocks stand still while a run waits for a lock, as for
  the slots: the wait counts toward no `timeout`. There is no separate wait
  limit for now; the wait is shown with its holder, and the maintainer can stop
  it.
- **Span.** On a `forEach` node the hold is per item: each item's integration
  takes and releases the lock, so the builders still run in parallel and only
  integration goes in turn.
- **Names and order.** One lock name per node, so workflows can't take two locks
  in different orders.
- **Where the ledger is.** Machine-wide, in `~/.ork`. A branch lock is keyed by
  the origin's URL and the branch, so two clones (or projects) pushing the same
  remote branch are ordered too.
- **Resume.** Stopping a run releases its lock; a crashed holder's record is
  swept, as the leases' are. A resumed run takes the lock again and reruns the
  locked nodes from the first one (fetch, rebase, check, push), since the branch
  may have moved.
