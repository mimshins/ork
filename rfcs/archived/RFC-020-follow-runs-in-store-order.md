# RFC-020 — Following many runs in store order

- **Status:** Implemented
- **Date:** 2026-11-15
- **Supersedes:** —
- **Superseded by:** —

## Context

`followRuns` serves `ork logs -f --all` and `ork decide --follow`; `ork attach`
follows a run and the runs it called with `followRunTree`
([specs/scheduler/calls.md](../../specs/scheduler/calls.md)). `followRuns`
adopts one `followRunTree` per root run
([follow-runs.ts](../../packages/core/src/remote/follow-runs.ts)), and each run
is followed apart: pushed over its socket, or polled from the store every 250 ms
when it has none ([follow.ts](../../packages/core/src/remote/follow.ts)). Events
of different runs therefore reach `onEvent` in arrival order, not the order they
were stored.

That is the residual in
[specs/gaps/machine-limits.md](../../specs/gaps/machine-limits.md) (L383). The
prompts that `ork decide --follow` and `ork attach` share
([`createPrompts`](../../packages/cli/src/runs/prompts.ts)) hold decisions that
arrive while a card is up and ask the earliest opened next, in the store's order
(`ORDER BY d.opened_at, d.rowid`,
[decisions.ts](../../packages/core/src/store/decisions.ts)). With no card up,
the first decision to arrive is asked at once, though another run may have
opened one earlier within the same poll. `ork logs -f --all` has the same shape:
lines of different runs interleave in arrival order.

What the store offers as an order across runs: the `events` table is keyed
`(run_id, seq)` and `WITHOUT ROWID`
([schema.ts](../../packages/core/src/store/schema.ts)), so `seq` orders one run
only; each stored event also has `at`, an ISO time written by the store when it
appends ([sqlite.ts](../../packages/core/src/store/sqlite.ts)). All runs on a
machine are written by processes sharing one clock.

The brief asks that `followRuns` and `followRunTree` deliver events in store
order across runs, so the first arrival with no card up is the earliest opened
decision. It changes `logs -f --all` ordering too, so it is planned as its own
change.

## Options

### Option A — Merge by event time with a short hold

Keep the per-run followers (sockets and polls). `followRuns` buffers each event
for a short window and releases the buffer sorted by `(at, run, seq)`, so an
event is never passed on before an earlier one from another run that arrives
inside the window.

- **Pros:** no store, schema or socket change; keeps push delivery; the code
  stays in `packages/core/src/remote/`; every consumer of `followRuns` gets the
  order.
- **Cons:** every event is delayed by up to the window; the order is exact only
  for events that arrive within one window of each other; `at` has millisecond
  resolution, so ties need a rule (run, then `seq`).

### Option B — Read one cross-run feed from the store

Add a store query for events after a cursor across runs, ordered by
`(at, run, seq)`, and have `followRuns` poll it in place of per-run followers.

- **Pros:** the order is the store's, with no hold window.
- **Cons:** gives up socket push, so every event waits for a poll (250 ms by
  default); adds a store API and a cursor over `(at, run, seq)`; `followRunTree`
  would no longer be the unit `followRuns` builds on.

### Option C — Add a global event sequence to the store

A new `events` column (a migration) gives one total order across runs, carried
in `StoredEvent` and on the socket; `followRuns` merges on it.

- **Pros:** a true total order, with no ties and no clock.
- **Cons:** a migration of a `WITHOUT ROWID` table; a `StoredEvent` and socket
  format change that older `ork` processes on the machine would not send; the
  heaviest change for a limit that is a few hundred milliseconds wide.

### Option D — Leave core alone; settle in the prompts

`createPrompts` waits one poll before asking the first arrival with no card up,
then asks the earliest open decision from `store.decisions`.

- **Pros:** a small CLI-only change.
- **Cons:** does not do what the brief asks (`followRuns` and `followRunTree`
  passing events on in order); `logs -f --all` stays in arrival order; every
  other reader of `followRuns` has to settle for itself.

## Decision

Option A: `followRuns` merges the events of the runs it follows by event time,
holding each for a short window and releasing them sorted by `(at, run, seq)`.
It is the only option that closes the residual in core without a store, schema
or socket change, and it keeps the push delivery that Option B gives up.

The window, and which layer holds it, are for the plan to settle (see Open
questions).

## Consequences

- `ork decide --follow` and `ork attach` ask the earliest opened decision first
  even with no card up, within the window; the held-decision logic in
  `createPrompts` stays for what arrives while a card is up.
- `ork logs -f --all` prints lines of different runs in store order, each a
  window later than today.
- Specs to update: [scheduler/calls.md](../../specs/scheduler/calls.md) (the
  order `followRuns` delivers), [cli.md](../../specs/cli.md) and
  [cli/decisions-and-stopping.md](../../specs/cli/decisions-and-stopping.md)
  (the prompts' order), and L383 in
  [machine-limits.md](../../specs/gaps/machine-limits.md), removed when it is
  closed (a limit that remains, for events further apart than the window, stays
  there). User docs and the Next release note change with the ordering of
  `logs -f --all`.
- Tests in `packages/core/test/follow-runs.test.ts` and `follow-tree.test.ts`
  for two runs whose events arrive out of store order, with no conditionals in
  the test body.
- An ADR when it ships; no new dependency.

## Open questions

- **The window.** No measurement says how late an event of another run can
  arrive: a socketless run is polled every 250 ms, so the window may have to
  match `intervalMs`. The plan sets it from the poll interval or measures it; it
  is not fixed here.
- **Where the merge sits for `followRunTree`.** Within one tree a called run's
  stored events print right after the `call.started` that started it
  ([follow-tree.ts](../../packages/core/src/remote/follow-tree.ts),
  `logs-many.ts`'s `treeEvents`), not interleaved by time with the caller's
  later events. Whether the tree keeps that call order and only `followRuns`
  merges across trees, or `followRunTree` also merges by `at`, changes how
  `ork logs <run>` and `ork attach` print called runs. The brief names both; the
  plan decides, and says so if `ork logs <run>` changes.
- **The stored backlog at start.** Events already stored when following starts
  arrive in one pass; whether the same sort applies to them, or only to live
  events, is for the plan to settle.
- **Ending.** Events held in the window when `untilIdle` or an abort ends
  following must be released or dropped; which, is for the plan.
