# ADR-007 — A safe expression language for conditions and templates

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** workflow format / engine
- **RFC:** waived — decided in design review on 2026-10-30

## Context

Edges need conditions (`when: verdict == 'approve'`) and briefs need values from
inputs and earlier nodes (`{{nodes.spec.output.artifacts.spec}}`). Workflows are
shared files, so anything that evaluates them is a way for a file from someone
else to run code on the user's machine ([SECURITY.md](../SECURITY.md)).

## Decision

A small expression language, parsed and evaluated by Ork itself
([parse.ts](../packages/core/src/expr/parse.ts),
[evaluate.ts](../packages/core/src/expr/evaluate.ts)):

- literals (strings, numbers, `true`, `false`, `null`), dotted and indexed
  paths, `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `!`, and parentheses;
- a fixed set of functions: `any`, `all`, `count`, `len`, `contains`;
- no assignment, no method calls, no property access outside own properties
  (`constructor`, `__proto__` read as undefined), and no route to JavaScript;
- the same expressions inside `{{ }}` templates;
- scope roots `inputs`, `nodes`, `output`, `run`; in a `when:`, a bare name
  reads the source node's output.

The compiler checks every path an expression reads against declared inputs,
existing nodes, and known report fields. Details:
[specs/expressions.md](../specs/expressions.md).

## Options considered

- **JavaScript expressions** (as n8n does). Powerful, and arbitrary code from a
  shared file.
- **A sandboxed JS engine.** Large, and sandboxes have a history of escapes.
- **An existing expression library** (for example JSONata, CEL). More features
  than a workflow needs and another dependency to trust.
- **A small, purpose-built language** — chosen.

## Rationale

Ork's conditions are comparisons over report fields; a few hundred lines cover
them, are easy to audit, and can be checked statically, which no general
language allows as cheaply.

## Consequences

- A new function is a change to the language and its spec.
- Errors carry the column of the problem, so `ork validate` can point at it.
