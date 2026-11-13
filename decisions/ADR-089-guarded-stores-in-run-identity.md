# ADR-089 — A run's marker lists the stores it guards

- **Status:** Accepted
- **Date:** 2026-11-13
- **Topic:** run identity / CLI guards on acting as the user
- **RFC:** waived: the maintainer decided it directly on 2026-11-12 (Q1 = A of
  the plan "Close the QA workflow's blind spots"), weighing the options below
- **Amends:** [ADR-047](./ADR-047-script-identity-env-json.md) (the marker a
  session or program carries, and where the guards refuse)

## Context

[ADR-047](./ADR-047-script-identity-env-json.md) makes `ork chat`,
`ork continue`, `ork decide --choose`, `ork watch --accept`, `ork pause`,
`ork attach` and the sign-in link of `ork ui` refuse when `ORK_RUN` or
`ORK_SESSION` is set. The marker says that a run started the process, not which
store the run uses. So a tester in a QA run, with `HOME` pointed at a throwaway
store, was refused for a run of its own: `ork ui` and `ork decide` could never
be tried. QA run c9c908b9 left both untested.

## Decision

**The marker carries the guarded stores.** A session and a program in a run get
`ORK_GUARDED_STORES`, a JSON array of the real paths of the store files of the
runs that started them. `ORK_RUN` and `ORK_SESSION=1` keep their meaning.

- **A nested run adds to the list, never replaces it.** The inner run's own
  sessions and programs see the outer store and its own. Starting a throwaway
  run therefore cannot clear the guard of the real store.
- **The guards refuse only when a marker is set and the current store is
  guarded.** The current store is the one `HOME` gives (`storePath()`). Paths
  are compared as real paths, so a symlinked `~/.ork` is still caught, even when
  an agent sets `HOME`.
- **A marker with no list, or a garbled one, refuses everywhere.** That is the
  old `ORK_SESSION=1` (an older `ork`, or a variable set by hand), and it fails
  closed.
- **The list is JSON, not a `:`-joined path list.** A path with a `:` would
  split wrongly, and a wrong split could drop a guarded store and fail open.
  JSON matches the style of ADR-047's other variables. The helpers
  (`guardedStoresIn`, `storeGuarded`, `guardOf`) live in
  `packages/nodes/src/run-marker.ts`.
- **A workflow's `env:` cannot set the variable.** It joins the identity keys
  that `env:` may not set, and core already refuses every `ORK_*` name.
- Refusal texts, the commands guarded, and what stays open (`ork decide --list`,
  `ork stop`) do not change. It is still not a boundary
  ([L80](../specs/messaging/scripts-limits.md)): an agent can unset the
  variables.

## Options considered

- **A. Guard only the stores of the enclosing runs (chosen).** Sessions and
  programs carry the list; a nested run adds to it; no list fails closed. All
  the guarded commands behave the same way, and nothing in the shipped CLI is
  special to QA.
- **B. A temp-HOME exemption.** The guard stands down when `ORK_QA=1` is set and
  the store resolves under `os.tmpdir()`. Declined: a test-only switch and a
  tmpdir heuristic in the shipped CLI.
- **C. The workflow starts `ork ui` for testers with the markers unset.**
  Declined: a bypass done by a script, sign-in links in the run record, and
  `ork decide` and starting `ork ui` stay untested.
- **D. Keep the guard and hand the UI and decision checks to the maintainer.**
  Declined: the blind spot becomes a manual checklist.
- **E. A node setting that drops the session marker.** Declined: it weakens the
  guard for the real store too.

## Consequences

- A tester under a temp `HOME` can start `ork ui --no-open`, get its sign-in
  link, and answer a decision of its own throwaway run, while the real store
  stays guarded.
- The guard helps only where the `ork` running the outer workflow sets the list.
  An older `ork` sets `ORK_SESSION=1` alone, which refuses everywhere (fail
  closed).
- A process that points `HOME` at a store the list does not name is allowed:
  that is the point, and it is why this is not a boundary.
- `ork mcp` still reads only `ORK_RUN` and `ORK_SESSION` to refuse `start_run`.

Spec: [scheduler](../specs/scheduler.md),
[running and runs](../specs/cli/running-and-runs.md),
[limits](../specs/messaging/scripts-limits.md). Builds on
[ADR-047](./ADR-047-script-identity-env-json.md).
