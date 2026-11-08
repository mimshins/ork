# The file and its graph

_Part of [Workflow file format](../workflow-format.md)._

**Files:**

- `.ork/workflows/<name>.ork.yaml`: the committed workflow.

**Serialization rules:**

- Where a node sits on a canvas isn't stored: it follows from the nodes and
  edges ([ADR-051](../../decisions/ADR-051-workflow-builder.md)). A
  `<name>.layout.json` left from before is ignored.
- Stable node ids.
- Deterministic key order.
- No absolute paths.
- Secrets only as `{{env.NAME}}` references in a tool node's `env:`.
- `schemaVersion`, checked on every read. A file with a higher version was made
  by a newer Ork, and gets that one message (`schema.newer_version`, with
  `ork upgrade` as the fix) instead of `expected 1`; the same goes for
  `project.yaml`, `triggers.yaml` and settings. There are no migrations yet: the
  first arrives with the first version 2. An additive optional field, such as a
  gate's `document`, needs no version bump.
- A published JSON Schema for editor autocomplete.

The canonical example is
[examples/software-factory.ork.yaml](../../examples/software-factory.ork.yaml).
Edges use a shorthand where possible:

```yaml
edges:
  - spec -> builder
  - builder -> security, ux, code # fan-out
  - security, ux, code -> reviews # fan-in
  - from: reviews
    to: builder
    when: any(statuses, 'changes_requested')
    maxRounds: 2 # every cycle needs a bound
```

**Graph rules:**

- A workflow may declare `outputs:`, a map of names to templates over its nodes,
  rendered when the run ends and handed to a
  [`workflow.call`](../scheduler/calls.md) that called it. It is optional.
- Templates use a small, safe expression language: `{{inputs.*}}`,
  `{{nodes.<id>.output.*}}` and `when:` predicates. No arbitrary JS.
- The graph compiler rejects:
  - cycles that have no `maxRounds`;
  - an unknown `parent`;
  - message edges that point to missing nodes;
  - skill and context references that don't resolve: paths are relative to the
    workflow file, and built-in skills are `ork:<name>`
    ([context](../context.md#references)).
