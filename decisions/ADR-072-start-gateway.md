# ADR-072 — One way in: a `start` workflow replaces `feature`

- **Status:** Accepted
- **Date:** 2026-11-09
- **Topic:** process
- **RFC:** waived — the maintainer decided this directly in a design review
- **Amends:** [ADR-071](./ADR-071-workflows-by-stage.md)

## Context

ADR-071 made `feature` a thin caller of `rfc`, `plan` and `build`, with two
routes. Work that had already reached a later stage had no way through it: an
Accepted RFC with work left, such as RFC-013, could only be planned by hand, and
a saved plan could only be built by calling `build` directly.

## Decision

`.ork/workflows/start.ork.yaml` replaces `feature` as the one entry point. A
read-only node reads the brief, `.ai/plans/` and `rfcs/active/`, and recommends
a route and a file. A `human.gate` offers `plan`, `rfc`, `from-rfc`,
`build-plan` and `stop`, and a note can name a different file. A path that can't
be used comes back to the gate with the reason, up to three times. Programs load
the chosen file, so no model copies it, and they accept only an RFC in
`rfcs/active/` or a plan in `.ai/plans/`, and the RFC must be Accepted. `plan`
now saves every approved plan in `.ai/plans/`, and never replaces one already
there.

## Options considered

- **`start` above `feature`.** Rejected: a new feature would pass through two
  routing steps and pay for two nodes that read the code.
- **Growing `feature` in place.** Rejected: the name stops fitting when the
  route is building an existing plan.
- **A QA route.** Left out by the maintainer; `qa-pass` runs alone.

## Rationale

Work should enter at the stage it has reached, without anyone remembering which
workflow that is. The recommendation costs one read-only node, and the choice
stays with the maintainer.

## Consequences

- `ork run feature` is gone; `ork run start` replaces it.
- A file over 60,000 bytes is refused, because a program's output is cut at 64
  KiB (G13). It can still be passed to `plan` or `build` directly.
