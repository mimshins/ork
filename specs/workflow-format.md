# Workflow file format

Status: **Built**: the Zod model, edge shorthand, canonical YAML, diagnostics,
[agents](./workflow-format/agents.md), `rules:` and the JSON Schemas
([code](../packages/schema/src/index.ts),
[tests](../packages/schema/test/yaml.test.ts)); node types execute in the
[scheduler](./scheduler.md). `forEach:` and the `list` output shape
([RFC-013](../rfcs/active/RFC-013-for-each.md)): the **schema**, the
[compiler's checks](./graph-compiler.md#rules), the
[scheduler](./scheduler/for-each.md), the walk and the CLI are built
([tests](../packages/schema/test/for-each.test.ts),
[checks](../packages/core/test/for-each-checks.test.ts)); the Monitor and the
Builder don't show fanned nodes yet. Why:
[ADR-006](../decisions/ADR-006-workflow-file-format.md),
[ADR-030](../decisions/ADR-030-agents-fill-nodes.md).

The format has one file per workflow, plus agent files; this document is the
hub.

## Contents

- [The file and its graph](./workflow-format/file-and-graph.md)
- [Node types and settings](./workflow-format/node-types.md)
- [Agents](./workflow-format/agents.md)
