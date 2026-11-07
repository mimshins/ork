# Feedback and self-improvement

Status: **Built**: capture (the `feedback` tool, system signals, fingerprints,
records grouped into items, and human notes from `ork feedback note`,
`ork decide --note` and the Monitor's Note dialog) and closing the loop:
`ork feedback list | show | note | dismiss | restore | accept | apply | triage | split | publish | export | import`,
Ork's own `ork:feedback-apply` workflow, lessons under a token cap, one rule for
what an item allows, the server's feedback routes and the UI's Feedback panel
([agent.ts](../packages/core/src/feedback/agent.ts),
[human.ts](../packages/core/src/feedback/human.ts),
[signals.ts](../packages/core/src/feedback/signals.ts),
[actions.ts](../packages/core/src/feedback/actions.ts),
[store](../packages/core/src/store/feedback.ts),
[tests](../packages/core/test/feedback.test.ts),
[built-in tests](../packages/core/test/builtin-workflows.test.ts),
[routes](../packages/server/src/feedback-routes.ts),
[panel](./ui/panels.md#feedback), [server](./server.md)). Not part of Ork: the
maintainers' scheduled triage of the Discussions category, an issues adapter,
any model call in triage, and lessons or fixes made without a person accepting
them. How it works for now: [limits](./gaps/limits-feedback.md). Why:
[ADR-013](../decisions/ADR-013-feedback-loop.md),
[ADR-028](../decisions/ADR-028-feedback-capture.md), amended by
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
