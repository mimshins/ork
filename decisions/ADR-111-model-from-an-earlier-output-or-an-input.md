# ADR-111 — A node's model from an earlier output or an input

- **Status:** Accepted
- **Date:** 2026-11-20
- **Topic:** workflow format
- **RFC:** [RFC-029](../rfcs/archived/RFC-029-model-from-an-earlier-output.md)

## Context

A node's `model` and `effort` could be a template only on a `forEach` node, and
only reading `item`. Anywhere else `ork validate` refused it with
`model.template`. A workflow that picks `claude-code.opus` for a security issue
and a cheaper model otherwise, from labels that arrive as an input or an earlier
node's output, needed two copies of the node behind a `control.router`.

## Decision

A `model` or `effort` on an agent node may be a template that reads `inputs.*`
and the output of a node that runs before it (`nodes.<id>.output.*`), and
`item.*` on a `forEach` node. Option A of the RFC, as written:

- **Validate:** `checkTemplate` checks the reads as it does a prompt's
  (`ref.input`, `ref.node`, `ref.field`, `template.not-upstream`). `item` and
  `index` off a fanned node still give `model.template` / `effort.template`, as
  does any template in `defaults.model` or `defaults.effort`, which stay
  refused. The per-item render check (`model.item`) runs only for a static list
  and only when the template reads nothing but `item` and `index`.
- **Plan:** the value is rendered when the node's session is planned. A rendered
  driver prefix (`claude-code.opus`) picks the driver and goes through the
  driver contradiction, driver fit and budget checks. A template pins no driver
  at validate; a literal prefix in front of a template still does.
- **Shape:** the rendered model is one word: no space, brace or quote, no
  leading `-` (it would read as a flag of the agent CLI), and no trailing `.` (a
  driver prefix with no model). An effort must be a level. Otherwise the node
  fails with the shape message.
- **Empty reads:** a template that reads `nodes.*` and renders empty fails the
  node when the plan has outputs, naming the read. A plan with no outputs
  (`ork run --node`, `ork chat`, an owner's fork) takes the default model and
  warns. An `inputs.*` or `item` template that renders empty still falls back to
  the node's default, then `defaults`.
- **Resume:** a session belongs to one driver. A node set to resume whose
  rendered driver differs from the one its session started on starts a fresh
  session, and its `node.started` carries `driverChanged: { from, to }`. A model
  change within one driver resumes. `ork resume` reads the earlier driver back
  from the run's events, and resumes as before when it cannot.

## Options considered

- **A, a template reading inputs and earlier outputs.** Chosen.
- **B, A plus `if(cond, a, b)` in expressions.** Not built. It changes the
  expression language for every template and `when:`; a decision of its own,
  open as an RFC if a helper node proves the common cost.
- **C, a router to two nodes that extend one definition.** Not built. It adds a
  node field, two nodes in the graph and breaks `session: resume` across them;
  its gain is an exact driver check at validate.

## Rationale

A is the smallest change that gives the case a working path with no new syntax
and no copied node, on top of a run side that already rendered with outputs. A
wrong model name still fails when the session starts, not at validate, because
the value is not known earlier.

## Consequences

- Choosing a model needs a helper node (a script or an agent that maps labels to
  a model name), because the language has no conditional.
- The driver fit check cannot run at validate for a template; the plan-time
  check covers it. An author who wants an exact check keeps a literal prefix.
- A `nodes.*` template that renders empty now fails a node that, for an item,
  would have fallen back: only a new case, so no run that worked breaks.
- A model name is not checked against a list (gap in
  [for-each-limits](../specs/gaps/for-each-limits.md)), and a called workflow's
  model input is not checked as a model name at its `workflow.call` site
  ([gaps](../specs/gaps.md)).
- Specs:
  [for-each](../specs/scheduler/for-each.md#an-items-own-model-and-effort),
  [node types](../specs/workflow-format/node-types.md),
  [expressions](../specs/expressions.md),
  [diagnostics](../specs/graph-compiler/diagnostics.md),
  [which driver](../specs/runtime/which-driver.md),
  [fresh sessions](../specs/scheduler/fresh-sessions.md#a-changed-driver). User
  guide:
  [choosing a model](../docs/guides/writing-workflows/choosing-a-model.md).
