# Task spec template

Copy to `.ai/specs/<kebab-name>.md` (local, gitignored) and fill it out before
an architectural or otherwise significant change. Delete it once the work lands:
its durable outcome belongs in a spec under `specs/`, an RFC, or an ADR.

```md
# <Title>

- **Author:** <who asked for it>
- **Related:** <issue, RFC, ADR, or spec>

## 1. Objective

_What this change achieves and why it is needed now._

## 2. Scope

_What is included, and what is explicitly out of scope._

## 3. Acceptance criteria

_Specific, checkable requirements. Each one can be verified by a test, a
command, or a look at a page._

- [ ] Criterion 1
- [ ] Criterion 2

## 4. Contracts and ports (if applicable)

_Types, interfaces, ports, package boundaries, MCP tools, CLI commands, or
events introduced or changed. Name the spec under `specs/` each one updates._

## 5. Workflow format (if applicable)

_New or changed fields, node types, edge options, or expression features; the
`schemaVersion` impact and migration; the JSON Schema regeneration; the examples
that change._

## 6. Behavior and rules

_Core logic, constraints, error handling, and the diagnostics a user sees._

## 7. Security and credentials (if applicable)

_What the change can reach on the user's machine; confirm Ork still stores no
credentials and writes no secret to logs, events, artifacts, or files._

## 8. Risks and alternatives

_What could go wrong, and the options considered. Real alternatives mean an RFC
(`rfcs/active/`)._

## 9. Tasks

_Ordered, actionable steps, each small enough to review on its own._

1. …
```
