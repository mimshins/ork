# Feedback and self-improvement

Status: **Partial**: capture is built: the `feedback` tool, system signals,
fingerprints, records grouped into items, and human notes, and
`ork feedback list | show | note | dismiss | restore`
([agent.ts](../packages/core/src/feedback/agent.ts),
[human.ts](../packages/core/src/feedback/human.ts),
[signals.ts](../packages/core/src/feedback/signals.ts),
[store](../packages/core/src/store/feedback.ts),
[tests](../packages/core/test/feedback.test.ts),
[ADR-028](../decisions/ADR-028-feedback-capture.md)); so is Ork's own
`ork:feedback-apply` workflow, run with `ork run`
([tests](../packages/core/test/builtin-workflows.test.ts)), and accepting an
item, as a lesson its workflow reads under a token cap, `apply`, which has that
workflow propose a fix, triage by rules, and notes from `ork decide` and the
server ([routes](../packages/server/src/feedback-routes.ts)), publishing to
Ork's Discussions, and export and import as JSON lines, and the UI's Feedback
panel ([panels](./ui/panels.md#feedback), [routes](./server.md)). Why:
[ADR-013](../decisions/ADR-013-feedback-loop.md), amended by
[ADR-059](../decisions/ADR-059-closing-the-feedback-loop.md).

Every run teaches something: a tool that got in the way, a brief that missed
context, an `AGENTS.md` that is out of date. Ork captures that feedback locally,
groups it, turns accepted feedback into fixes and lessons, and lets you publish
feedback about Ork itself to its GitHub Discussions.

## Contents

- [Capturing feedback](./feedback/capture.md): the three sources, the `feedback`
  tool, the three targets, storage, and grouping records into items (`list`,
  `show`, `note`, `ork decide --note`).
- [Closing the loop](./feedback/closing-the-loop.md): triage by rules, fixes
  through `ork:feedback-apply`, lessons and their cap, and why a person accepts
  each.
- [Sharing feedback](./feedback/sharing.md): publishing an item about Ork to its
  Discussions, deduplication, and export and import as JSON lines.
