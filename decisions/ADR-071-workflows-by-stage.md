# ADR-071 — Ork's own process as staged workflows that ask the maintainer

- **Status:** Accepted; amended by [ADR-072](./ADR-072-start-gateway.md)
- **Date:** 2026-11-09
- **Topic:** process
- **RFC:** waived — the maintainer decided this directly in a design review

## Context

`.ork/workflows/feature.ork.yaml` was one workflow from brief to publish. It
never mentioned RFCs, its only entry point was the spec-writer, so an approved
plan was planned again, and the spec-writer drafted without asking. The first
time the maintainer saw a design choice was the finished document at the
approval gate. Builders' questions went first to a fork of their leader, which
could answer them. In the stored runs, agents were named as the decider far more
often than the maintainer.

The maintainer wants their effort in three places: turning a brief into a plan
or an RFC, design decisions, and publish gates.

## Decision

- **Four workflows, joined by `workflow.call`.** `rfc`, `plan` and `build` each
  run alone. `feature` only reads the brief, asks for the route, and calls them.
- **The route is a `human.gate`,** with a recommendation from a read-only node,
  so an agent can't skip it.
- **Design decisions go to `ask_user`.** A design decision is anything AGENTS.md
  says needs an ADR, or anything that changes what users see. The spec-writer
  and rfc-writer ask before drafting, and builders ask rather than choose.
  Leaders always pass these on.
- **A `ratify` gate follows review,** and shows the decisions made during the
  build before ADRs are written.
- **An Accepted RFC is published at its own gate,** so it reaches `main` or a
  branch before anything is planned from it. Its text then travels in `outputs`.
  It gets one ADR, and `pnpm rfc:close` does the mechanical close-out.
- **`.ai/specs/` becomes `.ai/plans/`, and "task spec" becomes "plan".** A
  `specs/` document says what Ork does; a plan says how one change gets built.
  The agent keeps the name `spec-writer`.

## Options considered

- **Pass the RFC to the build leader instead of a plan.** Rejected: an RFC has
  no task order, file ownership or acceptance criteria, and every builder would
  carry its full length.
- **One workflow with branches.** Rejected by the maintainer in favour of
  separate workflows that can also be started on their own.
- **`ask_user` for the route.** Rejected: routing has fixed options, so a gate
  makes it impossible to skip.
- **A script that opens the ratify gate only when an agent made a
  hard-to-reverse decision.** Not possible for now: a `continue` node finds its
  worktree through gates and control nodes only, so a tool node before `docs`
  would move it to the wrong checkout ([L213](../specs/gaps.md#limits)).
- **Forwarding called runs' questions to the caller's terminal.** Rejected for
  now: it needs a runtime change, and `ork decide` and the Decisions panel
  already reach them.

## Rationale

The document you need depends on what is still uncertain: which approach (an
RFC), or how to build it (a plan). Separate workflows let work enter at the
stage it has reached. Asking before drafting puts the maintainer's judgment
where it changes the outcome, instead of asking them to find buried choices in a
finished document.

## Consequences

- A called run has no terminal, so `feature`'s questions wait in `ork decide` or
  the Decisions panel of `ork ui`, even when `ork run feature` is in a terminal.
- A call's clock keeps running while a called run waits on the maintainer (L55),
  so each call in `feature` sets its own 24-hour `timeout`, over the project's
  45-minute default, and `feature`'s limit is 72 hours.
- An RFC published to a branch ends the run; only one on `main` goes on to a
  plan, since later runs start from local `main`.
- ADR-001's link to the plan template was updated for the rename, the one edit
  to an accepted ADR, and closing an RFC rewrites links to it across the docs.
- `ratify` runs on every build, including when no agent made a design decision.
- `ask_user` has no separate document (L192), so long options must fit in
  `context`.
- A `fix` workflow for bugs is still to build (C13).
