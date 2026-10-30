# Workflow file format

Status: **Built**: the Zod model, edge shorthand, canonical YAML, diagnostics
and the JSON Schema ([code](../packages/schema/src/index.ts),
[tests](../packages/schema/test/yaml.test.ts)); node types execute in the
[scheduler](./scheduler.md). Why:
[ADR-006](../decisions/ADR-006-workflow-file-format.md).

**Files:**

- `.ork/workflows/<name>.ork.yaml`: the committed workflow.
- `.ork/workflows/<name>.layout.json`: optional canvas positions, kept separate
  so that logic diffs stay clean.

**Serialization rules:**

- Stable node ids.
- Deterministic key order.
- No absolute paths.
- Secrets only as `env:` references.
- `schemaVersion` with migrations.
- A published JSON Schema for editor autocomplete.

The canonical example is
[examples/software-factory.ork.yaml](../examples/software-factory.ork.yaml).
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

- Templates use a small, safe expression language: `{{inputs.*}}`,
  `{{nodes.<id>.output.*}}` and `when:` predicates. No arbitrary JS.
- The graph compiler rejects:
  - cycles that have no `maxRounds`;
  - an unknown `parent`;
  - message edges that point to missing nodes;
  - skill references that don't resolve.

**Built-in node types in v1:**

- **Agents:** `claude.leader`, `claude.worker`, `claude.subagent`.
- **Tools:** `tool.gh`, `tool.aws`, `tool.shell` (each runs the user's own CLI,
  and a per-node allowlist sets which subcommands are permitted).
- **Control:** `control.split`, `control.join` (all, any or n),
  `control.router`. Loops are edges with `maxRounds`, not a node.
- **Human:** `human.gate`.
- **Edges:** `input`/`output` artifacts.

What each type does when it runs, and how edges, joins and loops behave, is in
[Scheduler: running a workflow](./scheduler.md).
