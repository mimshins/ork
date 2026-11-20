# ADR-106 — `tool.result` carries the message of an Ork tool's refusal or failure

- **Status:** Accepted
- **Date:** 2026-11-20
- **Topic:** runtime port, feedback
- **RFC:** waived by the maintainer (a decision made directly; options below)

## Context

Feedback about a refused or failed Ork tool call (`tool.arguments`,
`tool.error`) said only that it happened. Every driver's decoder read the tool's
text to tell a refusal from a failure and then dropped it, so the record could
not say what was wrong, and its title named the node, so each node that hit the
same refusal made a new item. Over three runs that was 5 items for 7 refusals of
`extract`. Gap L195 asked for a short, scrubbed copy of the message.

## Decision

The runtime port's `tool.result` event gains `message?: string`: for an Ork
tool's refusal or failure, its first line, clipped to 300 characters.

- **Only Ork-marked results carry it.** A decoder sets `message` from the same
  text it reads for `fault`, and only when that text is Ork's own: it starts
  with `Invalid arguments, nothing ran:` or with the failure marker Ork's tools
  put on an `isError` result. A Bash or Read result, or Claude Code's own
  validation text, has no `message` on any driver.
- **Feedback uses it as evidence.** `tool.arguments` and `tool.error` records
  add the message to their evidence, after `maskSecrets` and the run's env-value
  scrubber (`SignalOptions.scrub`), first line only and at most 300 characters.
- **Items are titled by tool.** `tool.arguments` becomes
  `Ork's <tool> tool refused a call's arguments`, like `tool.error`'s title. The
  node leaves the title and so the fingerprint: one item per tool, shared across
  nodes and runs. The record keeps its `node`, so the origin still says who
  called.

## Options considered

- **A message for every error result.** Would also explain a Bash or Read
  failure, but stores other tools' output (paths, file contents, command lines):
  a privacy and size cost the feedback loop does not need. Rejected.
- **The call's input as evidence.** Shows what the agent sent, not why Ork
  refused it, and inputs can be large or hold secrets the patterns do not know.
  Rejected.
- **Ork-marked results only (chosen).** Ork's own text, plus the agent's own
  input echoed back in it (a refused path or pattern); small, scrubbed, and
  bounded by what Ork writes.

## Consequences

- A runtime-port change, hard to reverse: drivers set `message`, and
  `feedback.recorded` evidence and the stored events carry it. It is optional,
  so older events and other consumers are unaffected.
- Items filed before this change keep their per-node titles and fingerprints;
  they stay separate and no longer grow. The maintainer resolves or dismisses
  them.
- Within one run only the first record per tool is kept (a later message for the
  same tool is dropped), and Claude Code's own validation text has no marker, so
  it files as `tool.error` without a message. Both are recorded in
  [gaps](../specs/gaps.md).
- No workflow-format or schema change, and no new dependency.
