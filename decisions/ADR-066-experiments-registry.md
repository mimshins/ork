# ADR-066 — Experiments: one registry, an explicit opt-in, off by default

- **Status:** Accepted
- **Date:** 2026-11-08
- **Topic:** cross-cutting
- **RFC:** waived — the maintainer chose directly on 2026-11-07, and
  [ADR-061](./ADR-061-release-channels-toward-1-0.md) (decision 4) already
  rejected the alternatives to flags on `main`

## Context

[ADR-061](./ADR-061-release-channels-toward-1-0.md) keeps one line of
development: work that isn't ready for everyone merges into `main` behind an
explicit opt-in, and a canary is a snapshot of `main`. That needs one way to
name an experiment, turn it on, and see that it is on, or each experiment would
invent its own flag, and a misspelled flag would look like a feature that does
nothing.

## Decision

1. **One registry.** `EXPERIMENTS` in
   [experiments.ts](../packages/core/src/experiments.ts) is the only list: an
   entry (name, summary, spec) is added by the change that adds its experiment.
   It ships empty.
2. **Two ways on.** `experimental: [<name>]` in the project's `project.yaml`,
   and `ORK_EXPERIMENTAL=<name>[,<name>…]`. Both at once give the union. The
   schema accepts any string; the core checks names, since schema sits below
   core.
3. **An unknown name is an error,** in the checks every workflow goes through
   (`ork validate`, `ork run`, the builder, the MCP tools, triggers), named with
   its source and the known names. `ork doctor` fails that one check and exits
   non-zero; its other checks still run.
4. **One question to ask.** A consumer calls `experimentOn(name, …)` and never
   reads the file's key or the variable itself. A gate that refuses words its
   message with `experimentOffMessage(name)`.
5. **Not recorded with a run.** The opt-in stays a property of the machine and
   the project, read again each time a workflow is checked, resumes included.

The detail is in [project rules](../specs/project-rules.md#experiments).

## Options considered

- **Accept any name, warn on an unknown one:** a typo then looks like a running
  experiment, which is the mistake the registry exists to catch.
- **List `for-each` now:** turns on a name with nothing behind it. It joins the
  registry in the change that builds it.
- **Per-workflow or per-node opt-in:** finer, but one project-wide switch is
  what the first experiments need, and a workflow file that names an experiment
  would be a format change.
- **A long-lived `canary` branch instead of flags:** rejected in ADR-061.

## Rationale

A list in one place makes "is this on?" one function, gives a typo an error, and
keeps experiments findable, since each entry names its spec. An opt-in in both
the project file and the environment covers a team trying something together and
one person trying it alone.

## Consequences

- Every experiment adds one entry, and one `experimentOn` gate at the place it
  would otherwise take effect.
- Removing an entry makes the name an error for any project still listing it.
- Nothing promotes or removes an experiment yet ([gaps](../specs/gaps.md), G28).
- A run resumed without the opt-in it started with is that experiment's own
  concern, to settle when one depends on it.
