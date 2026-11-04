# RFC-010 — Conditions chosen from what a node declares it can say

- **Status:** Accepted
- **Date:** 2026-11-04
- **Supersedes:** —
- **Superseded by:** —

## Contents

- [Context](#context)
- [Options](#options)
- [Decision](#decision)
- [Consequences](#consequences)
- [Answered questions](#answered-questions)

## Context

[RFC-009](./RFC-009-walking-a-workflow.md) finds workflows that can't do what
they say. The maintainer's response set the order: **prevent a mistake where
possible, and detect only what's left.** A typo that can't be typed needs no
error message. That takes structured outputs, as a list of choices can only come
from a declared shape.

### Where a condition comes from today

In the builder a `when:` is a text box
([connections.tsx](../../packages/ui/src/builder/connections.tsx)), described as
"such as status == 'pass'". Everything the Context of RFC-009 lists as a typo
starts there, even where Ork already knows every value.

### What Ork knows about each node's output

| Node                              | Fields                                    | Values known today                                                |
| --------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| `claude.*`                        | `status`, `summary`, plus `output.schema` | `status` is a closed list; a schema field can list its own        |
| `human.gate`                      | `choice`, `answeredBy`                    | `choice` is one of its `options`                                  |
| `workflow.call`                   | `status`, `summary`, `run`, `outputs`     | `status` is `pass` or `fail`                                      |
| `control.join`                    | `statuses`, `results`, `count`            | `statuses` holds its inputs' statuses                             |
| `control.router`, `control.split` | Those of the node before                  | Those of the node before                                          |
| `tool.*`                          | `exitCode`, `stdout`, `stderr`, `json`    | None. `output: { format: json }` says it's JSON, not what's in it |
| `mcp.call`                        | `json`, `text`                            | None                                                              |

So most values can already be offered as choices. Tools and MCP calls are the
exception, and the steps Ork most wants to rely on, as they cost no model turn.
`json.state == 'opne'` can't be caught by anything today.

### A declared value isn't yet a checked one

A dropdown is only honest if the value it offers is the value that arrives.

- `status` is checked, by `parseReport`
  ([report.ts](../../packages/core/src/runtime/report.ts)), and a session
  without a valid report ends as `fail`.
- A schema field isn't checked there. `parseReport` reads `status` and
  `summary`, and passes the other fields through. The schema goes to the
  session, but this RFC hasn't verified that each driver enforces it.
- A tool's JSON is only checked to be JSON.

So a value outside the list can reach a condition, which then doesn't match, and
the run takes no edge and says nothing.

### What can't be prevented this way

Whoever writes YAML by hand has no dropdown, and no schema can tie a `when:` to
the node that the edge leaves. A condition on free text, such as
`contains(stderr, 'timeout')`, has no list to choose from. And a mistake in how
several conditions combine, like an impossible join, is made of valid choices.
RFC-009 stays for these.

## Options

### Option A — Detect only

Keep the text box, and rely on the compile error in RFC-009.

- **Pros:** no format or UI change.
- **Cons:** the typo gets made, then reported, and tool outputs stay unchecked.

### Option B — Suggestions on the text box

Autocomplete the known fields and values while typing.

- **Pros:** small, and keeps full expressions in one place.
- **Cons:** a suggestion can be ignored, so a typo is still possible. Someone
  new to the expression language still has to write it.

### Option C — Choices from what's known, with no format change

Replace the text box with dropdowns over the table above.

- **Pros:** no format change, and it prevents every typo on Claude nodes and
  gates.
- **Cons:** tools and MCP calls stay free text, though they are what
  deterministic workflows branch on. Schema fields stay unchecked at runtime.

### Option D — Declared outputs for every node, checked at runtime, and choices from them

Option C, plus `output.schema` on tools and MCP calls, and one runtime check for
every declared value.

- **Pros:** one list for each node, read by the picker, the compiler, the walk
  and the run, so they can't disagree. A script that says something undeclared
  fails right there, with a reason, in place of a condition quietly not
  matching.
- **Cons:** a format addition, and a behavior change for anyone who declares a
  field: a value outside the list now fails the node. Declaring takes effort, so
  it has to stay optional and has to be easy.

### Option E — A structured `when:` in the file

Write `when: { field: status, is: pass }` in place of an expression.

- **Pros:** the file's own shape rules out some syntax mistakes.
- **Cons:** two spellings of a condition, or a migration of every file. A JSON
  Schema still can't tie the value to the source node, so a typo still passes.
  The expression is readable, and it's what `git diff` shows.

### Option F — Require a declared shape on all JSON output

Reject `format: json` with no schema.

- **Pros:** the strongest prevention.
- **Cons:** breaks every such node, including those that pass JSON to a template
  and never branch on it, and asks for a shape nobody will read.

## Decision

**Option D.** Every node has one declared list of what it can say. The builder
offers it as choices, and the run holds the node to it. `when:` stays an
expression in the file, so the format's readers, diffs and hand-writers lose
nothing.

### 1. Tools and MCP calls can declare their output

```yaml
pr:
  type: tool.gh
  command: pr view {{inputs.pr}} --json state,mergeable
  output:
    format: json
    schema:
      state: [OPEN, CLOSED, MERGED]
      mergeable: string
```

It uses the shape Claude nodes already have: a list of values or a primitive
type. A declared field is required, as on a Claude node. Fields sit one level
down; anything deeper stays undeclared. `mcp.call` gets the same
`output.schema`.

It stays optional. A condition or template reading `json.<field>` with no
declaration gets a new warning, `ref.undeclared`.

### 2. The run holds a node to what it declared

One check, in one place, for tool JSON, MCP results and Claude schema fields: a
missing field, the wrong type or a value outside the list fails the node, and
the reason names all three, as in
`pr: state is "DRAFT", expected OPEN, CLOSED or MERGED`.

A failing node is handled like any other: `when: "!ok"` or `status == 'fail'`
can catch it, and an unhandled one fails the run with that reason.

It needs no new dependency. It reads this shape, not general JSON Schema. A
Claude schema field written out as raw JSON Schema stays the driver's to
enforce.

### 3. The builder picks conditions from choices

On an edge, the text box becomes:

| Choose               | Offers                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Follow this edge** | When it succeeds (no `when:`), when it fails, or when a test holds                                           |
| **Field**            | The source's fields, through a router or split to the node before                                            |
| **Test**             | What suits the field: is or isn't; above or below for a number; any, all or how many for a join's `statuses` |
| **Value**            | The listed values; a number or text box only for a field with no list                                        |

More rows join with all or any. It writes the same `when:` as a person would,
and that text is what gets saved.

**Other mistakes it closes:**

- **A gate's edges** start from its options: each option can be given its own
  edge in one step, and an unhandled one shows as ending the run.
- **Renaming an option or listed value** follows into the conditions that read
  it, as a node rename does today. Removing one says which edges use it, and
  asks.
- **Closing a loop** asks for the condition and the rounds together, so an edge
  can't sit in a state the compiler rejects. "Every round" stays a choice, named
  for what it does.
- **A new edge from a looping node** starts with "when the loop isn't taken", so
  it doesn't fire on every round by accident.
- **A router** gets an "otherwise" choice.
- **A join's `n`** only offers 1 up to its number of inputs.

**Declaring as you go:** where a tool has JSON and no such field, the picker
offers "Add a field", which writes the field to `output.schema` and the
condition to the edge in one edit, so one undo takes both back.

**An expression the rows can't show** stays as written, in a text box marked
"Written by hand". It's never rewritten to fit, which keeps the promise of
[ADR-051](../../decisions/ADR-051-workflow-builder.md) that a file stays as its
author wrote it. Free text remains where no list can exist.

### 4. One source for all of it

A single function in `core`, beside `outputFieldsOf`
([types.ts](../../packages/core/src/graph/types.ts)), gives each node's fields
and values. The compiler's `when.value` (RFC-009), the walk's outcomes
(RFC-009), the runtime check and, through the builder's view, the picker all
read it.

## Consequences

**Better:**

- In the builder, a value typo can't be made wherever a list exists, and the
  checks in RFC-009 become the fallback for hand-written files.
- Structured output pays off more than once: a declared field is a dropdown, a
  check on the run and an outcome for the walk.
- A script that changes what it prints fails loudly at that node, with a reason,
  in place of a run that takes no edge and says `succeeded`.

**Worse:**

- Checking Claude schema fields at runtime can fail a session that works today,
  if a driver lets an undeclared value through. A failed report is a costly way
  to find out, so the first task is to measure whether a driver can do this, and
  that decides how the message reads.
- The picker is more UI than a text box, and needs its own keyboard and
  screen-reader pass, and copy from the design language.
- Declared output can go stale when a script changes. That's the purpose, but
  it's one more thing to keep up, and it's why declaring stays optional.

**Follow-up work:**

- Update [workflow-format.md](../../specs/workflow-format.md), the JSON Schema,
  [graph-compiler.md](../../specs/graph-compiler.md) for `ref.undeclared`,
  [scheduler.md](../../specs/scheduler.md) for the failure,
  [ui](../../specs/ui.md#workflow-builder) for the picker, and
  [the scripts guide](../../docs/guides/scripts.md).
- Write the ADR. Build this before RFC-009's walk, as the walk reads its lists.

**Later, each its own change:**

- **Prefill a schema from a real run:** after `ork run --node`, offer the fields
  the node really printed. Deterministic, and it makes declaring nearly free.
- **Read an MCP tool's own output schema,** where a server publishes one.
- **Pick values into templates** the same way, so `{{nodes.x.output.y}}` in a
  prompt is chosen, not typed.

## Answered questions

The maintainer's answers, on 2026-11-04.

1. **Should a value outside the list fail the node, or only warn?** Fail the
   node, as a warning leaves the same silent dead end. This covers Claude schema
   fields too, so the first task is still to measure whether a driver can let a
   bad value through, as that decides how the failure reads, not whether it
   happens.
2. **What should reading an undeclared `json.<field>` do?** Warn, with
   `ref.undeclared`, and the scripts guide declares its output in the same
   change.
3. **How deep do declared fields go?** One level. A deeper result stays free
   text.
