# ADR-095 — Follow several runs in store order

- **Status:** Accepted
- **Date:** 2026-11-15
- **Topic:** core, CLI, following runs
- **RFC:** [RFC-020](../rfcs/archived/RFC-020-follow-runs-in-store-order.md)

## Context

`followRuns` and `followRunTree` followed each run apart, so events of different
runs reached `onEvent` in arrival order. With no card up, `ork decide --follow`
and `ork attach` asked the first decision to arrive, though another run may have
opened one earlier within the same poll, and `ork logs -f --all` interleaved
lines in arrival order. The prompts' held queue only ordered what arrived while
a card was up ([L383](../specs/gaps/machine-limits.md), now closed).

## Options considered

- **A. Hold and sort in the follower (chosen).** No store, schema or socket
  change.
- **B. A cross-run store feed.** A store query or change feed that returns
  events of many runs in order.
- **C. A global event sequence.** One counter across runs, written by the store.
- **Prompts only.** Settle a decision briefly before asking it; leaves
  `logs -f --all` interleaved by arrival.

B and C change the store and the event format for a delay of one poll.

## Decision

- **A hold-and-sort buffer** (`order-events.ts`, internal to core) holds each
  event for `intervalMs ?? 250` ms, then releases them sorted by
  `(at, run, seq)`. On the timer it sorts what it holds and releases the prefix
  through the last event held a full window; a younger event that sorts before
  it goes too.
- **`followRuns` always orders**, over all its trees, so a caller and its called
  runs are ordered too. **`followRunTree` orders only with the opt-in `ordered`
  option**, which `ork attach` passes; `ork logs <run>`, `ork logs -f <run>` and
  `--no-calls` keep a called run's stored events right after its `call.started`.
- **The stored backlog is sorted like live events**, one rule, so start-up
  decisions are asked in the order they opened.
- **Held events are all delivered, in order, when following ends by itself**
  (`untilIdle`, the root ending), and **dropped** when `signal` aborts or a
  follower fails. A throw from `onEvent` on a timer release fails the follow as
  a pushed event's throw does.
- **Dedup and `call.started` handling stay before the buffer**, on the raw
  event.

## Consequences

- Every followed event is delayed up to one window; the first lines of
  `logs -f --all` and the first prompt of `decide --follow` appear about one
  poll later.
- The order is exact for events stored more than about one drain apart or whose
  arrival lag is within the window. Events further apart than that can still be
  delivered in arrival order; the sort relies on `at` not decreasing within a
  run ([L384](../specs/gaps/machine-limits.md)). `--limit` of `logs -f --all`
  first counted in read order; it now counts in store order too, through the
  same `compareStoreOrder`.
- Reversible: no stored data or format changes.
