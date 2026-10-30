# ADR-013 — The feedback loop

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** feedback / self-improvement
- **RFC:** waived — decided in design review on 2026-10-30

## Context

Every run teaches something: a tool that got in the way, a brief that missed
context, an `AGENTS.md` that is out of date. The maintainer wanted agents under
Ork to give feedback, the feedback stored locally, used to improve the system,
and publishable to Ork's GitHub Discussions, in a way that scales.

## Decision

1. **Three sources:** system signals derived from the event store (free), an
   agent `feedback` tool (capped per session), and human notes.
2. **Three targets:** `ork` (the harness), `workflow` (this workflow's design),
   `project` (the repo's context). Only `ork` feedback is ever published.
3. **Local first.** A `feedback` table in `~/.ork/state.db`, secrets masked on
   write, each record also an event in its run.
4. **Fingerprints** (target, kind, tool or error code, normalized title) group
   records into items with counts, so volume does not become noise.
5. **Triage is an Ork workflow** (`ork:feedback-triage`), so Ork improves itself
   with its own engine.
6. **Fixes and lessons are human-accepted.** `ork feedback apply` proposes a
   diff as a Decision; an accepted lesson goes to `.ork/lessons/<workflow>.md`
   and is loaded in the workflow context layer under a token cap. Nothing is
   applied automatically.
7. **Publishing is per item and previewed**: redacted, shown as a Decision, then
   posted with the user's own `gh` to the `agent-feedback` Discussions category;
   a hidden fingerprint marker turns a duplicate into a "+1" comment.
8. **Milestones:** capture in M1d; triage, apply, lessons, and publishing in M2.

Details: [specs/feedback.md](../specs/feedback.md).

## Options considered

- **Ork-only feedback** versus **ork, workflow, and project targets** — the
  maintainer chose all three.
- **Lessons:** none, human-accepted only, or automatic — human-accepted chosen.
- **Publishing:** per item, a periodic digest, or both — per item chosen.
- **A telemetry backend run by Ork.** Rejected: it contradicts
  [ADR-004](./ADR-004-no-credentials.md)'s "your accounts" stance and is a
  privacy risk.

## Rationale

Feedback is model output that repository content can steer (prompt injection),
so anything that changes future runs or posts publicly passes a human. Local
storage and the user's own `gh` keep Ork without a server or a data store of
other people's code.

## Consequences

- Maintainers see one Discussions thread per real problem, with a count.
- The `agent-feedback` category is found by slug, never by id.
- Feedback adds a tool to every session, so its description and cap must stay
  small in tokens.
