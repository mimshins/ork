# RFC-029 — A node's model from an earlier output or an input

- **Status:** Accepted
- **Date:** 2026-11-20
- **Decided:** by the maintainer on 2026-11-20 (option A)
- **Supersedes:** —
- **Superseded by:** —

## Context

A node's `model` (and `effort`) may be a template only on a node with `forEach`,
reading only `item` (`model: "{{item.model}}"`,
[an item's own model and effort](../../specs/scheduler/for-each.md#an-items-own-model-and-effort)).
Anywhere else `ork validate` refuses it with `model.template` (and
`effort.template`):

- [item-settings.ts](../../packages/core/src/graph/item-settings.ts),
  `checkNodeField`, refuses a template off a `forEach` node, then any read whose
  root is not `item`; `checkItemSettings` refuses one in `defaults`.
- [item-settings.test.ts](../../packages/core/test/item-settings.test.ts) pins
  both: `model: "{{inputs.level}}"` and
  `model: "{{nodes.other.output.summary}}"` give `model.template`.
- [Diagnostics](../../specs/graph-compiler/diagnostics.md#diagnostics) lists the
  codes.

The case that asks for more: a workflow such as `se-backend`'s issue flow picks
`claude-code.opus` for a security or money issue and a cheaper model otherwise,
decided from the issue's labels, which arrive as an input or as an earlier
node's output. Today the only way is two copies of the node behind a
`control.router`, with their `when:` conditions.

What the code already does, checked on 2026-11-20:

- **The run side needs little.** `modelOf`
  ([brief.ts](../../packages/core/src/run/brief.ts)) renders `model` and
  `effort` with `runScope(run.inputs, run.outputs ?? {}, undefined, run.item)`,
  so a template that reads `inputs` or `nodes` renders at run time as soon as
  the compiler lets it through. The plan
  ([plan.ts](../../packages/core/src/run/plan.ts) lines 156-164) then runs
  `driverContradiction` and `modelDriver` on the rendered value, as for an item,
  so a rendered `claude-code.opus` still picks its driver, and the driver fit
  and budget checks see the real model.
- **A template pins no driver when validated.** `pinnedDriver`
  ([driver.ts](../../packages/core/src/run/driver.ts)) reads the text as
  written; `{{nodes.pick.output.model}}` names no driver, so `ork validate`
  cannot check the driver fit for it. A literal prefix with a rendered rest
  (`claude-code.{{inputs.tier}}`) does pin it.
- **Other templates already have the checks this needs.** `checkTemplate`
  ([templates.ts](../../packages/core/src/graph/templates.ts)) reports an
  unknown input (`ref.input`), an unknown node or field (`ref.node`,
  `ref.field`) and a node that does not run first (`template.not-upstream`);
  `model` is not among the fields it walks.
- **The expression language has no conditional**
  ([expressions.md](../../specs/expressions.md#functions)): `any`, `all`,
  `count`, `len`, `contains`. A node's template can read a value but not choose
  between two. An edge's `when:` can (`contains(output.labels, 'security')`),
  which is why the router works today.
- **Model names are checked by shape only.** Ork keeps no list of model names,
  so a name Claude Code does not know fails when the session starts
  ([L262](../../specs/gaps/for-each-limits.md)). Only `omp` has a list
  (`omp models --json`), and the driver check only counts it
  ([cli-drivers.ts](../../packages/integrations/src/cli-drivers.ts)).

## Options

### Option A — Open `model` and `effort` templates to `inputs.*` and upstream `nodes.<id>.output.*`

A node's `model` and `effort` may be a template reading `inputs.*` and the
output of a node that runs before it, on any agent node and not only a `forEach`
one. The rendered value is checked at run time, as an item's is today: its shape
(`model` one word, `effort` a level), then the driver prefix, the driver fit and
the budget. An earlier script or agent node reports the model, so the labels
case is a small node (a script that maps labels to a model name) and one
template: `model: "{{nodes.pick.output.model}}"`.

- **Pros:**
  - No new syntax, field or node type; the change is lifting a compile check and
    reusing `checkTemplate`, and the run side already renders with outputs.
  - One node stays one node: its prompt, context, tools, session and worktree
    are not copied, and what follows reads one output.
  - Works from an input too (`{{inputs.model}}`), so whoever starts the run
    chooses.
  - The mechanism is the one an item's model already uses, so the rendering,
    shape check, driver prefix and fit check are shared.
- **Cons:**
  - Choosing needs a node that computes the model, because the language cannot
    branch; a workflow that only wants "opus if labelled" carries a helper node.
  - `ork validate` cannot check the driver fit for a rendered prefix, and a
    wrong name fails when the session starts (L262), not before the run.
  - Plans that have no outputs to render with (`ork run --node`, `ork chat`, an
    owner's fork) fall back to the default model, as they do for an item
    ([L262](../../specs/gaps/for-each-limits.md)); with this change the
    fall-back also reaches a non-fanned node.

### Option B — A plus a conditional function in expressions

As A, and `if(cond, a, b)` in the expression language, so the node writes the
choice in the template and needs no helper node.

- **Pros:**
  - The labels case is one node and one line.
  - A conditional helps every template, prompts included.
- **Cons:**
  - A change to the expression language (ADR-007, `parse.ts`, `evaluate.ts`) for
    every template and `when:`, which is a decision of its own and independent
    of where a model may come from.
  - A grammar to keep safe and to document in the UI's expression help.

### Option C — No template: a router picks one of two nodes that share a definition

Keep `model` static. A `control.router` (`mode: first`) routes on a `when:` that
reads the labels, to two nodes that differ only in `model`. To avoid copying the
node, add a way for a node to extend another and override fields.

- **Pros:**
  - Every model is a literal, so `ork validate` sees the driver and the fit
    check is exact, and a wrong name is the file's, not a run's.
  - Needs no change to how templates are checked.
- **Cons:**
  - A new node field (`extends`, or alike) across the schema, compiler, the
    Builder and its panels, and the JSON Schema.
  - Two nodes in the graph, two session rows in `ork usage`, and a downstream
    node must read either one: a `control.join` with `mode: any`, or a reference
    to the skipped sibling.
  - `session: resume` cannot cross the two nodes.
  - Rules out choosing a model from an input value on one node.

## Decision

**Option A.** A `model` or `effort` template on an agent node may read
`inputs.*` and the output of a node that runs before it, and is rendered and
checked when the node's session is planned, as an item's value is. The labels
case is an earlier node that reports the model and a node whose
`model: "{{nodes.<pick>.output.model}}"` reads it.

A is the smallest change that gives the case a working path with no new syntax,
no copied node and no change to the expression language. B is better only if a
helper node proves to be the common cost, and C buys exact driver checks at the
price of a new node field and a wider graph; neither is ruled out for later.

## Consequences

- **Compiler:** `checkNodeField` drops the `forEach`-only and `item`-only
  refusals for an agent node; it runs `checkTemplate` over the text for `ref.*`
  and `template.not-upstream`; `item`/`index` roots remain legal only on a
  `forEach` node, with the existing item checks. `defaults.model` and
  `defaults.effort` stay refused. The error `model.template` narrows to what is
  left, a template in `defaults` and `item` off a fanned node.
- **Run:** `modelOf` is unchanged in shape; its tests gain a rendering from an
  output and from an input. A non-empty rendered value runs through
  `driverContradiction`, the driver fit check and the budget check.
- **Specs:** [for-each.md](../../specs/scheduler/for-each.md) (its "An item's
  own model and effort" section says a template is item-only),
  [node-types.md](../../specs/workflow-format/node-types.md),
  [expressions.md](../../specs/expressions.md#scope),
  [diagnostics.md](../../specs/graph-compiler/diagnostics.md) and
  [which-driver.md](../../specs/runtime/which-driver.md) change.
  [L262](../../specs/gaps/for-each-limits.md) widens: a model from an output or
  an input is checked by shape, and a plan with no outputs falls back to the
  default.
- **Docs and UI:** the user guide for `model`, a bullet in
  [Next release](../../docs/whats-new/next-release.md), the Builder's model
  field (it presents a template today only for a fanned node), and the schema's
  descriptions. A changeset.
- **ADR:** one, on shipping, and `pnpm rfc:close RFC-029`.
- **Not decided here:** a conditional function (Option B) and a node that
  extends another (Option C). Each would be its own RFC.

## Open questions

- **An empty render.** An item that renders empty falls back to the node's
  default, then `defaults`. For a template reading a skipped or failed node
  (`pick` never ran), the same fall-back would hide the mistake behind the
  default model. Should an empty render from `nodes.*` fail the node instead?
  The behavior carried over, unless the maintainer changes it, is the item's:
  fall back.
- **`session: resume` and loops.** A node in a loop whose rendered model differs
  between rounds resumes a session started on another model, or on another
  driver. Nothing in the code read for this RFC says what happens; the plan
  should check the resume path and refuse or restart when the model changed.
- **`defaults.model` from `inputs`.** `defaults:` may not read a node's output,
  but could read `inputs`. Left refused here; say if
  `defaults.model: "{{inputs.model}}"` is wanted.
- **`workflow.call`.** Whether a called workflow's declared input for the model
  is checked as a model name at the call site is not established.
