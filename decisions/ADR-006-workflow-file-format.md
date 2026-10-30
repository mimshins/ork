# ADR-006 — The workflow file format

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** workflow format
- **RFC:** waived — decided in design review on 2026-10-30

## Context

Workflows designed in the CLI or the UI must be fully serializable, so users can
share them and version them with git. Reviews must see logic changes, not
reformatting or moved canvas boxes. The format is a public contract: other
people's files have to keep loading as Ork evolves.

## Decision

1. **YAML**, one workflow per `.ork/workflows/<name>.ork.yaml`, validated by a
   Zod model ([workflow.ts](../packages/schema/src/workflow.ts),
   [nodes.ts](../packages/schema/src/nodes.ts)) and published as a JSON Schema
   for editor autocomplete.
2. **A canonical serializer owns the formatting**
   ([yaml.ts](../packages/schema/src/yaml.ts)): fixed key order, node ids in
   authored order, edges in shorthand where possible, byte-stable on round trip.
   oxfmt does not format `*.ork.yaml` (its prose wrapping would fold long values
   and fight the serializer); a test keeps the examples canonical.
3. **Layout in a sidecar.** Canvas positions live in `<name>.layout.json`, node
   ids sorted, so moving a box never touches the workflow.
4. **Edge shorthand.** `a -> b`, `a -> b, c`, `a, b -> c`, or the object form
   with `when` and `maxRounds` ([edges.ts](../packages/schema/src/edges.ts)).
   Brackets are not used: `[a, b] -> c` is not valid YAML.
5. **Loops are bounded edges.** A cycle is legal only through an edge with
   `maxRounds`; there is no `control.loop` node.
6. **Versioned.** Every file carries `schemaVersion: 1`; a breaking change bumps
   it and ships a migration.
7. **No defaults written back.** Schema fields that have defaults are optional
   in the model, and the defaults are applied by the compiler, so a round trip
   never adds keys the author did not write.

Details: [specs/workflow-format.md](../specs/workflow-format.md).

## Options considered

- **JSON.** Machine-friendly; poor for humans to read, diff, and comment.
- **YAML formatted by a general formatter.** Two formatters disagreeing on the
  same file.
- **Layout inside the workflow file.** One file to share, but every drag on the
  canvas becomes a diff in the logic.
- **A loop node.** Familiar from n8n, but it duplicates what an edge with a
  bound already expresses.

## Rationale

YAML is readable and diffable; one canonical writer makes every save of the same
workflow identical, so `git diff` shows only real changes. Bounded edges make
every loop's limit visible at the place the loop closes.

## Consequences

- Comments in a workflow file are not preserved by a save through Ork yet; a
  comment-preserving document edit can come later behind the same serializer.
- Editors get validation and completion from `workflow.schema.json` (regenerated
  by a script; a test fails when it is stale).
