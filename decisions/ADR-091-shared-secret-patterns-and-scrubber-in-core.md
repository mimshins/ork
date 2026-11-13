# ADR-091 — The secret patterns and the env-value scrubber live in core

- **Status:** Accepted
- **Date:** 2026-11-13
- **Topic:** `packages/core` public exports, `packages/nodes`, `tools/audit`,
  masking
- **RFC:** waived: the maintainer chose to share one list and to move the
  scrubber (plan "Sign-in code, wider masking, agent-facing hardening and task
  labels", workstream B); QA bd542734

## Context

Ork kept two lists of credential formats that had drifted: `maskSecrets` (what
is stored) missed npm, `sk-proj-`, Google and Stripe live keys and
`password=`/`token=` forms, while `tools/audit` knew them. The scrubber that
masks the values of a node's `env:` secrets (`scrubberOf`) lived in
`packages/nodes`, so core's feedback and follow-ups, which store text, could not
call it, and a configured secret's value reached them unmasked.

## Decision

1. **One provider list in core.** `SECRET_PATTERNS` (`{ name, pattern }`, at the
   audit's thresholds) is in `packages/core/src/store/secret-patterns.ts` and
   exported. `maskSecrets` builds its masks from it, keeps its own looser
   mask-only patterns (`gh*_` from 20 characters) so no mask gets weaker, and
   adds generic `password`, `passwd`, `secret`, `token` and `api_key` forms
   (value of 8 or more characters; a `{{…}}` template is not a value).
2. **`tools/audit` imports the list from core**, by the relative path of core's
   entry point (`../../packages/core/src/index.ts`): `tools/` has no workspace
   link to `@krapht/ork-core`, and a root dependency would change the lockfile.
   `tools/audit/secret-patterns.ts` is gone; its tests keep their thresholds.
3. **The scrubber moves to core.** `scrubberOf`, `runScrubber`, `envValuesOf`,
   `Environ` and `readEnv` move from `packages/nodes` to core (public entry
   point); nodes imports them from there, as the dependency direction allows.
4. **Feedback and follow-ups take an optional `scrub`** (`createFeedback`,
   `scrubFollowUp`, and the human-note path), set by the run from
   `runScrubber(maskedNames, environ)`. They apply `maskSecrets` first, then it.

## Options considered

- **Keep two lists, add a test that they agree:** still two places to edit.
- **Put the list in `tools/` and import it from core:** inverts the dependency
  direction.
- **A root workspace dependency for `tools/audit`:** a lockfile change for one
  import; the repository already imports package entry points by path in
  `tools/release`.

## Consequences

- A new credential format is one line, and the store, feedback and the audit all
  see it.
- Generic `token=` masking can over-mask ordinary log text in stored events;
  masking is the safe side.
- The human-note callers (`ork feedback note`, `ork decide --note`, the server's
  route) pass a scrubber built from the run's workflow file (`scrubberOfRun` in
  nodes); the server, which has no dependency on nodes, gets it from `ork ui` as
  the `noteScrub` option. A file that is gone or invalid leaves patterns only.
- Encodings such as base64 stay out of the scrubber (already
  [L81](../specs/messaging/scripts-limits.md)).

Spec: [masking](../specs/event-store.md#masking),
[feedback](../specs/feedback/capture.md), [follow-ups](../specs/follow-ups.md).
