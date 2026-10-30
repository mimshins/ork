# ADR-021 — Built-in practices: caveman and ponytail, on by default

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** context / token use
- **RFC:** waived — the author asked for it and chose among the options below

## Context

Ork's premise is a harness with good practice built in, including saving tokens.
Two widely used skills address the two biggest sources of waste in agent work:
**Caveman** (verbose chat; Apache-2.0) and **Ponytail** (more code than the task
needs; MIT; its own benchmark reports about 22% fewer tokens, an independent
test about 10% lower cost). se-backend already vendors Caveman (its ADR-033) as
a skill file rather than installing its CLI or hooks.

## Decision

1. **Vendor both as Ork practices**, adapted text in
   [packages/core/src/practices/](../packages/core/src/practices/index.ts), at
   pinned upstream tags at least 7 days old (Caveman v4.0.1, Ponytail v5.3.2),
   with attribution in each file and in
   [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), which ships with the
   CLI. No upstream CLI, hooks, proxy or network call.
2. **On by default** for every Claude node.
3. **A `practices:` block** on `defaults` and on Claude nodes turns them off, or
   sets Ponytail's level (`lite`, `full`, `ultra`).
4. **The setting cascades down the ownership tree**: own, then nearest owner,
   then `defaults`, then on.
5. **Caveman's scope**: chat text, report summaries and messages to other nodes;
   never files, code, comments, commits, docs, artifacts, or questions to the
   user.
6. **The project's own skill of the same name wins**, so nothing loads twice.

Detail: [specs/context.md](../specs/context.md#built-in-practices).

## Options considered

- **Toggle shape:** top-level `caveman:` / `ponytail:` keys; a `practices:`
  block — chosen, so later practices add no new top-level keys.
- **Inheritance:** per node plus `defaults`; cascading down the ownership tree —
  chosen, matching how owners give their descendants context.
- **Caveman's scope:** chat only; chat, reports and messages — chosen, since
  agents read reports and every token is billed.
- **Install the upstream plugins** instead of vendoring: brings hooks and
  per-machine installs outside Ork's control, and is not reproducible from the
  repository.

## Rationale

Both are prompt text, not runtimes, so vendoring them is cheap, auditable and
offline. Delivering them in the system prompt keeps them always on (as their
upstream hooks do) and cache-friendly. Cascading matches Ork's ownership model.

## Consequences

- The workflow format gains `practices` (no `schemaVersion` bump: it is optional
  and additive).
- Updating either practice is a deliberate re-vendor with a version change.
- Ork refers to "Caveman" by name only to identify that project (nominative use
  under its trademark policy).
