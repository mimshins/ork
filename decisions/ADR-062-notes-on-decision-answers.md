# ADR-062 — Notes on decision answers

- **Status:** Accepted
- **Date:** 2026-11-08
- **Topic:** messaging / decisions
- **RFC:** waived — the maintainer decided the behavior directly (gap G19, for
  `1.0.0-alpha.0`); the flag's name and the port's shape were settled while
  building it

## Context

Every decision (a `human.gate`, `ask_user`, a permission prompt, a loop out of
rounds) was answered with an option id only. A "request changes" answer couldn't
carry what to change, so Ork's own `feature` workflow told the person to send
the spec writer a message with `ork chat` before answering `revise`, which
nothing enforced. `ork decide` already had `--note` and `--rating`, which record
feedback about the decision's node, not words for the run.

## Decision

Any answer may carry an optional **note**
([messaging](../specs/messaging.md#decisions)):

- It is trimmed (blank is none), masked like other decision text, stored on the
  decision record (`note`, store migration 16) and in `decision.answered`.
- A gate outputs it as `note`, an empty string when none was given or the
  timeout answered: a later node reads `{{nodes.<gate>.output.note}}`, and an
  edge can test it (`when: "note != ''"`). `ask_user` returns it after the
  choice; a denied tool's message ends with it. A loop out of rounds or a link
  at its limit only records it (G22).
- `ork decide --id … --choose … --say <text>` gives it. `--note` and `--rating`
  keep their meaning: feedback on the node
  ([CLI](../specs/cli/decisions-and-stopping.md)).
- The run's terminal offers one optional line after the choice (after a denial,
  for a permission), which Enter skips; the decision stays open while it waits.
  The Decisions panel has a labelled, optional note box; the server's answer
  route takes `{ choose, note? }`.
- The runtime port's `HumanChannel.ask` and `permit` take an optional
  `onNote(note)` that the decision queue calls before the answer resolves
  ([runtime](../specs/runtime.md)); their return types are unchanged.

## Options considered

- **`--note` for the answer's note, feedback moved to a new flag** (with the old
  one kept for a while, or warned about). The word fits, but anyone who already
  types `ork decide --note "…" --rating bad` would have their feedback start
  going to the run instead, silently or after a warning.
- **`--say` (chosen) or `--message` for the answer's note, `--note` kept for
  feedback.** Nothing changes for current users. `--message` was left out
  because `ork feedback note -m` already uses it for feedback text.
- **A port change returning `{ choice, note }` from `ask`.** Cleaner to read,
  but it changes every channel and every test double, including the run's
  wrappers; an optional `onNote` passes through the wrappers that forward the
  question untouched.

## Rationale

The fewest surprises for people who use `ork decide` today: `--note` still does
what it did, and the run's words get a flag of their own whose name says it
speaks to the run. An empty-string `note` on every gate output keeps templates
and conditions simple, with no missing-field case.

## Consequences

- `feature` can carry the spec writer's changes in the gate's answer instead of
  an `ork chat` message first.
- The word "note" means two things in `ork decide`: the answer's note (`--say`)
  and a feedback note (`--note`). The guides and the help text keep them apart.
- `ork mcp` still never answers a decision; the plugin's hook still stops
  `ork decide --id … --choose …`, with or without `--say`.
