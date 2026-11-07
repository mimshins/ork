# ADR-064 — The Claude driver is chosen when a run starts

- **Status:** Accepted
- **Date:** 2026-11-08
- **Topic:** runtime
- **RFC:** waived — the maintainer chose directly, while setting up Ork's own
  workflows
- **Amends:** [ADR-005](./ADR-005-one-runtime-port-two-drivers.md) (which driver
  a node gets when nothing names one)

## Context

[ADR-005](./ADR-005-one-runtime-port-two-drivers.md) lets a node, or the
workflow's defaults, pick `driver: sdk | cli`; when nothing picked one, a run
took the SDK driver. `ork init` wrote the driver it found ready on the machine
into the project's committed files, so a teammate whose machine had the other
driver ready got a workflow that couldn't run for them. Committed workflows,
including this repository's own `.ork/`, should run on any contributor's
machine.

## Decision

1. **The order.** A Claude node's driver is the first of: `--driver` on the
   command line; the node's or its agent's `driver`; the workflow's, then the
   project's `defaults.driver`; the driver ready on this machine, the CLI driver
   when both are ([driver.ts](../packages/core/src/run/driver.ts),
   [ready-driver.ts](../packages/cli/src/run/ready-driver.ts)).
2. **Recorded once.** The ready driver is found when the run starts, recorded as
   the run's `settings.readyDriver`, and reused on resume, so a resumed run
   doesn't change driver because the machine did.
3. **`ork init` writes no driver.** `ork run` says which driver it took.

The detail is in the [runtime spec](../specs/runtime.md).

## Options considered

- **Keep the SDK driver as the default:** predictable, but most people have a
  `claude` login and no API key, so an unnamed driver failed for them.
- **Keep `ork init` writing the ready driver:** works for whoever ran it, and
  breaks the workflow for a teammate with the other driver. Rejected.
- **Require every workflow to name a driver:** explicit, but it puts a machine's
  detail in a shared file, the same problem as above.
- **Choose at run time** — chosen.

## Consequences

- A workflow that names no driver can run on different drivers on different
  machines; anything driver-specific must name its driver.
- A run started before this change recorded no driver, so resuming it finds the
  ready driver again ([gaps](../specs/gaps.md), G24).
