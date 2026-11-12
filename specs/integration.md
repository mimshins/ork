# Integration: locks, conflicts and issues in parallel

Status: **Built.** A node's `lock:` is held across nodes (the ledger, the wait,
the release, the resume), `ork doctor` sweeps stale records, and two workflows
use it: the `issues` example and `build`'s `publish`. Left simpler on purpose:
[L286–L299, L313–L316](./gaps.md). Code:
[the hold](../packages/core/src/run/locks.ts),
[the ledger](../packages/core/src/machine/lock-ledger.ts),
[doctor](../packages/cli/src/doctor/ledger-checks.ts),
[the field](../packages/schema/src/lock.ts)
([tests](../packages/core/test/locks.test.ts),
[checks](../packages/core/test/lock-checks.test.ts),
[the resolver](../packages/nodes/test/resolve-conflict.test.ts),
[the issues example](../packages/nodes/test/issues-example.test.ts)). Why:
[ADR-085](../decisions/ADR-085-lock-field-and-hold.md).

Runs already work side by side without conflicts: each has its own worktrees and
branches ([worktrees](./worktrees.md)). What needs an order is **integration**,
the moment work goes into one shared branch. Two runs that fetch, rebase and
push the same branch race, and the second push is rejected. This spec is how Ork
orders them (a **lock**), what happens on a rebase conflict (a **resolver**),
and the workflow that puts both to use on GitHub issues (**`issues`**). The
user's side is
[Working on issues in parallel](../docs/guides/issues-in-parallel.md).

## Contents

- [The `lock:` field](#the-lock-field)
- [The ledger](#the-ledger)
- [The hold](#the-hold)
- [A wait is shown](#a-wait-is-shown)
- [Stopping, resuming and crashing](#stopping-resuming-and-crashing)
- [The conflict resolver](#the-conflict-resolver)
- [The `issues` workflow](#the-issues-workflow)
- [`build`'s publish](#builds-publish)
- [What is not built](#what-is-not-built)

## The `lock:` field

A worker, a tool node or an `mcp.call` takes `lock: <name>`: one non-blank
string per node, so no workflow takes two locks in different orders. The name
may read `{{inputs.*}}` and nothing else a node produces, so it is known before
the run starts (`lock: "branch:{{inputs.branch}}"`). The field and its checks
are in the [node types](./workflow-format/node-types.md); a `schemaVersion`
change is not needed. A node group that names the same lock on every node of an
integration (fetch, rebase, resolve, check, push) holds it through all of them.

## The ledger

One **machine-wide** ledger in `~/.ork/locks`, so runs of different projects,
and two clones of one repository, are ordered too. Each lock is a one-slot
[slot ledger](./machine.md#slots) in its own folder named by a hash of the
lock's key, so no URL is stored on disk:

- **A key.** `branch:<name>` is keyed by the origin's URL (no scheme, no user
  part, no `.git`, so `git@host:org/repo` and `https://host/org/repo` read the
  same) and the branch: `branch:<origin>#<branch>`. With no origin, the
  repository's own path stands in. Any other name is keyed by the project's root
  and the name.
- **First come, first served.** A waiter takes a ticket; the lock goes in order.
- **A record** holds a run id, a node id and a pid, made with a hard link, so it
  is atomic and fails when it exists.
- **A dead holder's lock is taken over.** A record or ticket whose process is
  gone is swept by the next waiter. `ork doctor` does the same for every lock
  and for the check slots (closing [L259](./gaps/machine-limits.md)), naming
  each record it removed.

## The hold

A run holds a lock **across nodes**: it takes it before the first node that
names it runs, and lets it go when a node naming it ends and no node the graph
can still reach from there names it, and on every end of the run (success,
failure, stop, the sweep of a crash). While the run waits on a decision (a
`human.gate`, a worker's question) it keeps the lock, so a question about a
conflict does not hand the branch to another run. Two nodes naming the same lock
share one hold; the run is the holder, not a node.

- **A fanned node (`forEach`)** names the lock per item: its items take it one
  at a time, so builders in parallel stay parallel and only the locked step goes
  in turn. When the run already holds the same lock from an earlier node, its
  items join that hold and run side by side ([L291](./gaps/machine-limits.md)).
- **Events.** `lock.waiting` (`lock`, `holders` as `<run>/<node>`) while another
  run holds it, `lock.taken` (`lock`) when the node runs under it, and
  `lock.released` (`lock`, `end`: `span` when the last node naming it ended,
  `run` when the run ended holding it)
  ([events](./scheduler/resuming-and-events.md)).
- **Clocks.** The node's, its owners' and the run's clocks stand still while it
  waits: no `timeout` counts the wait. There is no wait limit of its own; the
  maintainer stops the run.

## A wait is shown

`ork ps`, `ork logs`, `ork tree` and the logs in `ork ui` show a waiting run as
`waiting for <lock>, held by <run>/<node>`, with the run's name for the lock as
it rendered it (`branch:main`). The holder is the node that took the lock, the
first of its hold, not the node now running under it
([L292](./gaps/machine-limits.md)).

## Stopping, resuming and crashing

Stopping a run releases its lock. A run that ended holding one (stopped, failed
or crashed) hands back nothing its locked nodes did under it, so a resume
**takes the lock again and runs those nodes again from the first one** (fetch,
rebase, check, push): the branch may have moved since. A crashed holder's record
is swept as above. Replay: [resuming](./scheduler/resuming-and-events.md).

## The conflict resolver

[`examples/resolve-conflict.ork.yaml`](../examples/resolve-conflict.ork.yaml) is
a workflow you run alone in a checkout where a rebase stopped, and the **node
group** a workflow that integrates copies into itself. Ork has no include or
reusable group in the format, and a `workflow.call` is a separate run with its
own checkout and its own hold, so it could neither continue the caller's rebase
nor sit under its lock ([L286](./gaps/conflict-resolver-limits.md)). The steps:

1. **`inspect`** (a script) refuses when no rebase is underway, lists the
   conflicted files, and shows what each side did: the upstream's diff against
   the base, and the replayed change's.
2. **`resolve`** (an agent `conflict-resolver`, tools `Read`, `Grep`, `Glob`,
   `Edit`, `Write`) edits only those files, never drops one side silently, and
   reports `behaviour` (`unchanged` or `changed`) and `kept` (what it kept from
   each side). It runs no git and does not finish the rebase.
3. **`stage`** (a script) fails on a conflict marker left, or on a file changed
   that is not conflicted, then stages the files and shows the result.
4. **`ask`**, only when `behaviour` is `changed`: a `human.gate` shows both
   sides, what was kept and the result, and asks to `keep` or `stop`. "Changed"
   means the same logic was edited on both sides and the resolver chose, merged
   or rewrote it. `stop` fails the run with the work in the checkout.
5. **`finish`** continues the rebase (or skips a change that is already
   upstream), then **`check`** runs the project's check. A failing check fails
   the node with the conflict's result kept in the worktree.

Ork **commits nothing** in a worktree while a rebase, merge, cherry-pick or
revert is underway, so the resolver's edits wait, uncommitted, for `finish`
([worktrees](./worktrees.md#after-a-node)). What a resolver's report means, and
what only a person catches, is in [L289](./gaps/conflict-resolver-limits.md): a
wrong resolution that passes the check is caught by the maintainer's answer and
the review of the pull request.

## The `issues` workflow

[`examples/issues.ork.yaml`](../examples/issues.ork.yaml), offered by
`ork init --issues` ([projects](./projects.md)), through the user's own `gh` and
git (Ork reads no token). Inputs: `label` or `issues` (numbers), `branch`
(default `ork/issues`), `base` (default `main`) and `check` (required).

1. **`list`** checks its inputs before any `gh` write, and refuses with one
   sentence on stderr: no `label` or `issues`, `branch` equal to `base`, a
   checkout with no commit or no `origin`, a non-numeric number, or more than 10
   distinct numbers (a number named twice counts once, the first kept). It reads
   the open issues by label that are not already `in-progress` (the first 10;
   `--search "-label:in-progress"`) or by number (an `in-progress` one is taken
   anyway), and creates the label if the repository has none. **`mark`** adds it
   to each, per item.
2. **`build`** is a worker per issue in its own worktree, three at a time;
   **`gather`** drops the ones whose builder failed ("its builder failed: …"),
   passed but left no branch (a run with `--in-place` makes none), or changed
   nothing, and **`review`** (readonly) checks each diff. A review that is not
   `pass` leaves the issue out ([L295](./gaps/issues-limits.md)).
3. **Integration** is a loop of nodes under `lock: branch:<branch>`, one issue
   per round: `next` picks the following issue, `integrate` fetches the branch
   (or the base when the branch is new) and rebases the issue's branch onto it,
   then a clean rebase goes to `check`, a conflict to the resolver group above,
   and `push` pushes one commit, `Resolve #n: <title>`. The lock is held from
   `next` to `pr`, so no other run pushes the branch in between, and each issue
   is rebased onto the one before it.
4. A step that fails (a conflict left, the maintainer's `stop`, a failing check)
   goes to `drop`, which aborts the rebase and names the issue as left out, and
   the loop goes on with the next one.
5. **`pr`** opens the pull request from `branch` to `base`, or **edits the
   existing one**: its body lists `Closes #n` for every integrated issue,
   earlier runs' included. It removes `in-progress` from each issue it touched,
   integrated or not. The run's outputs are `integrated`, `leftOut` and `url`.
6. **`unmark`** (a `tool.shell` on `node`) takes `in-progress` off every listed
   issue, ignoring failures, prints "The run stopped before its pull request;
   took in-progress off #1, #2." on stderr and **exits 1**, so the run ends
   `failed`. It is reached by `!ok` from `mark`, `gather`, `prepare`, `plan`,
   `next`, `drop` and `pr`, and by `!any(statuses, 'pass')` from `build` and
   `review` (every review `changes_requested` ends the run here, not as
   `succeeded`). A failed node that takes an edge counts as handled, so the
   run's reasons name `unmark`; the transcript still shows the first `✗`. A run
   that stops (`ork stop`, timeout, crash, budget) fires no edge, so its labels
   stay ([L313](./gaps/issues-limits.md)).

A **second run naming the same branch** therefore adds to the same pull request,
and **many runs** (of `issues` or any workflow whose publish names the same
lock) integrate into one branch in turn. The queue lives in files in the
integration worktree's git folder, so a resume starts it over
([L297](./gaps/issues-limits.md)).

## `build`'s publish

[`build.ork.yaml`](../.ork/workflows/build.ork.yaml) integrates through the lock
and the resolver group. Its `publish` commits, fetches and rebases the change in
the `docs` worktree, and reports `outcome: clean` or `conflict`; the nodes
`inspect`, `resolve`, `settle` (the group's `stage`), `ask`, `stop`, `finish`,
`check` and `push` follow, all with `lock: branch:main`, so the hold spans from
`publish` to `push` and two builds publishing go in turn (the one that waits
shows it, [a wait is shown](#a-wait-is-shown)).

- A clean rebase goes to `check` (`pnpm run check`, once), then `push`, which
  pushes the branch and opens or updates the pull request.
- A rebase conflict is no longer aborted: `publish` leaves it open, and the
  resolver group runs on it, `ask` only when the resolution changes behaviour
  (`stop` fails the run with the rebase open and nothing pushed), then `finish`
  and `check` on the resolved tree before `push`.
- `resolve` is `isolation: continue`, which finds a worktree only through an
  agent node's incoming edges, never a tool node's
  ([L288](./gaps/conflict-resolver-limits.md)). So `docs -> resolve` is an
  **inert edge**: its condition, `ok && !ok`, can never hold, so it is never
  taken and starts nothing (an edge that is taken starts its target each time,
  so a plain `!ok` would run the resolver when `docs` failed). It only lets the
  resolver work in `docs`'s worktree, where the rebase is.
- The lock is the constant `branch:main`, because a lock name may read only
  `inputs` ([`lock.scope`](./graph-compiler.md#rules)): a build that publishes
  to another branch is not ordered against an `issues` run on that branch
  ([L299](./gaps/issues-limits.md)).
- Otherwise its behaviour on `main` is as before: the choices, the note naming
  the branch and the changeset check are unchanged.

## What is not built

- A run per labelled issue, started by Ork (a later `ork watch` trigger), and
  one pull request per issue.
- Merge queues on GitHub's side.
- A reusable node group in the format
  ([L286](./gaps/conflict-resolver-limits.md)).
