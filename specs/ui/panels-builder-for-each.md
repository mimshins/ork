# The Builder: running a node once per item

_Part of [The panels](./panels.md)._

Status: **Built** (RFC-013, run 2), an addition to
[the Builder](./panels-builder-logs-and-decisions.md#builder). The format,
checks and engine are built ([for each](../scheduler/for-each.md)); this is how
the Builder draws and edits `forEach`
([RFC-013](../../rfcs/archived/RFC-013-for-each.md),
[ADR-070](../../decisions/ADR-070-for-each-field-group.md),
[ADR-052](../../decisions/ADR-052-conditions-from-declared-outputs.md)). The CLI
twin is the text editor and `ork validate`; the Builder saves nothing new.

## Contents

- [What it adds](#what-it-adds)
- [The For each group](#the-for-each-group)
- [Choosing the list](#choosing-the-list)
- [Declaring a list](#declaring-a-list)
- [Reading an item](#reading-an-item)
- [Conditions and lists](#conditions-and-lists)
- [What the checks say, and where](#what-the-checks-say-and-where)
- [Keys, names and tokens](#keys-names-and-tokens)

## What it adds

A node that takes `forEach` (`claude.worker`, every `tool.<id>`, `mcp.call`,
`workflow.call`) gets one group in its inspector. The group is a custom control
at `nodes.<id>.forEach`, as `until` and `parent` are
([custom-controls.tsx](../../packages/ui/src/builder/custom-controls.tsx)),
because the schema is a union of two objects the generated "Details / Details"
choice could not tell apart. A node that can't take it (control nodes,
`claude.subagent`, `claude.leader`, `human.gate`) shows no group, as the JSON
Schema has no key. The canvas does not change: a fanned node is one card, as in
the Monitor.

## The For each group

Purpose: set whether and how a node runs once per item, without YAML.

- **Run this node** is a select, the group's first control, always shown. Its
  options: "Once" (no `forEach`; choosing it deletes the key), "Once per item,
  listed here" (`items`) and "Once per item of a list from an earlier node"
  (`from`). The group opens when the key is set, as other groups do, and then
  stays open, so choosing "Once" from inside it does not close it.
- **Changing the kind** keeps `maxParallel` and `onFailure` and drops the other
  kind's keys. "Listed here" starts as `items: [""]`, one empty row. "From an
  earlier node" starts as `from: ""` and `maxItems: 10`, so the file is valid
  and the card says "1 error" until a list is chosen.
- **Items** (listed here) is the generated list, one row per entry: text, or
  JSON for a number or an object, as any free value is. It has no hint of its
  own. The schema needs at least one item, so "Once" is the way out.
- **List from** and **Most items** (from an earlier node), see below.
- **Most at once**: a number, optional. Hint: "Default: the run's
  `limits.concurrency`."
- **When an item fails**: a select of "Run every item" (the default, which
  deletes the key) and "Start no more items" (`stop`).
- **Numbers** (`Most items`, `Most at once`) commit when left. Only a whole
  number above 0 is sent. Anything else is not sent, and a problem line under
  the field says "Most items needs a whole number above 0."

The group's hint is the schema's description of `forEach`.

States: **not fanned** (group closed, "Once"); **listed** and **from** (open);
**from, no list chosen** (open, "List from" empty, a problem under it); never
disabled: an unfit node has no group.

## Choosing the list

"List from" is a select. It writes the whole template,
`{{nodes.<node>.output.<field>}}`, and shows `<field> (from <node>)`; below it,
in the hint style, the line `Writes {{nodes.plan.output.tasks}}`.

- **Offered:** only the list fields of nodes that run before this one. A node
  runs before it when a path of edges without a loop limit (`maxRounds`) leads
  from it to this node, the rule `forEach.order` checks, so the Builder never
  offers what the checks refuse. A list field is one whose `says` entry has
  `items` ([says.ts](../../packages/core/src/graph/says.ts)): a declared
  `{ list: … }`, or a fanned node's gathered `items` and `results`. `statuses`
  is not offered. No text, number, value or workflow input is offered.
- **Empty:** the select reads "Choose a list" and is not disabled. Under it: "No
  earlier node declares a list. Add one below, or connect this node after one
  that does." The Add a list button is the way on.
- **A value the choices don't offer** (a hand-written path, a node that no
  longer runs before this one) is kept as the select's first option, as its raw
  text followed by "(not offered)", so it is seen and its problem shows under
  it. Picking another list replaces it. The Builder never accepts typed paths.
- **Under the select,** once a list is chosen: "Each item has `title`, `files`."
  from the shape, or "Items have no declared fields." for `{ list: {} }`.
- **Most items** is required: its label has the required mark the generated form
  uses, and its hint is the schema's: "A longer list asks whether to stop, run
  this many, or run all."

## Declaring a list

A list exists in the dropdown only once an earlier node declares it in
`output.schema`. The control ends with **Add a list**, the same component as Add
a field in the condition picker
([declare-field.tsx](../../packages/ui/src/builder/declare-field.tsx)), in a
`list` kind. The condition picker does not offer lists.

- **Closed:** a button, "Add a list", with the unseen suffix ", for <id>". It is
  disabled when no earlier node can declare one (a Claude node, tool or MCP call
  whose type has an `output.schema`, not a fanned node), and the reason is text
  under it, not a tooltip: "No earlier node can declare a list. A list comes
  from a Claude node, tool or MCP call that runs before this one."
- **Open:** three fields and two buttons, in this order.
  - "On node": a select of the nodes that can declare, which run before this one
    (no loop edge on the path). Shown only when there are two or more.
  - "New list": text. Hint: "A field of the JSON that node gives, such as
    tasks." Must match the name rule fields use; if the node already has a field
    of that name, the problem reads "`tasks` is already a field of `plan`."
  - "Item fields": text. Hint: "Separated by commas: a name, or name:type.
    Types: string, number, integer, boolean. Empty for items with no fields." An
    unfit entry reads "`files:list` isn't a type. Use string, number, integer or
    boolean." and a repeated name "`title` is listed twice."
  - **Add tasks** (the name of the list; "Add list" while empty) is disabled
    until the name and every entry are valid. **Cancel** closes it.
- **Writes, as one change so one undo:**
  `nodes.<node>.output.schema.<name> = { list: { title: string, files: number } }`
  and `nodes.<this>.forEach.from = {{nodes.<node>.output.<name>}}`. A list with
  no fields is `{ list: {} }`. Types are written bare (`string`, not a list of
  values).
- **Focus:** opening moves it to the first field; Add or Cancel moves it back to
  the "Add a list" button, or to "List from" after Add.

Item fields that are value lists or nested lists are a text-editor edit, kept
untouched when seen here ([L214](../gaps/for-each-limits.md)).

## Reading an item

The Builder has no insert menu for references: a template is typed text
everywhere, and this stays so. `{{item}}` and `{{index}}` are _offered_ as
hints, only on a fanned node.

- **Which fields:** `prompt`, `command`, `arguments`, `inputs`, `env` and `ref`
  (the places the check allows). Each gains a last sentence in its hint: "Reads
  `{{item}}` and `{{index}}`, and `{{item.title}}`, `{{item.files}}`." The field
  names come from the list's shape; for a `from` with no shape, or `items` whose
  entries aren't all objects, only `{{item}}` and `{{index}}`; for `items` whose
  entries are all objects, the keys they share.
- **Not offered** in `instructions`, `context` or `skills`: their hint says
  nothing of it. Typed there it is `item.outside`.
- **Not fanned:** no hint mentions `item` or `index`, anywhere.
- **`model` and `effort`** on a Claude node may read `{{item.<field>}}` only,
  not `{{index}}`
  ([an item's own model and effort](../scheduler/for-each.md#an-items-own-model-and-effort)).
  Their hint does not mention it.
- **A templated `effort`** (`{{item.effort}}`) shows as a text field, kept as
  typed; a level shows as a choice.
- **In the group,** under the kind select, one line: "Items are `<id>.0` to
  `<id>.n`. Their results gather into `results`, `statuses` and `count`."

## Conditions and lists

A list can't be compared, so it is left out of every choice of fields: an edge's
condition, a router's, a `watch:`'s `until`, a gate's. This closes
[L208](../gaps/for-each-limits.md).

- A list field (a `says` entry with `items`) is not in the field select, and
  `firstRow` never starts a test on one. The tests table is unchanged.
- A fanned node's `statuses` and `count` stay, with their tests ("any is", "all
  are", "is above"…). To act on how many items failed, use `statuses`.
- A hand-written `when:` that reads a list shows as typed text, like any
  condition the choices can't say, so it is seen and fixed.

## What the checks say, and where

The checks are the compiler's ([for each](../scheduler/for-each.md)). The
Builder adds no checks of its own; it shows each where its path points, as it
does now (`context.problems`), and counts it on the card ("1 error", "1
warning").

| Code                  | Shown under                       | Is      |
| --------------------- | --------------------------------- | ------- |
| `forEach.from-path`   | List from                         | error   |
| `forEach.order`       | List from                         | error   |
| `forEach.not-list`    | List from                         | error   |
| `forEach.undeclared`  | List from                         | warning |
| `item.outside`        | the field that reads it           | error   |
| `item.field`          | the field that reads it           | error   |
| `model.template`      | Model                             | error   |
| `effort.template`     | Effort                            | error   |
| `model.item`          | the node's card only              | error   |
| `effort.item`         | the node's card only              | error   |
| `forEach.continue`    | Isolation                         | error   |
| `forEach.unreached`   | Owner                             | error   |
| `forEach.owner-order` | Owner                             | error   |
| `forEach.notify`      | the rule's To, on the notifier    | error   |
| `forEach.channel`     | Messages, with the workflow's own | error   |

`forEach.channel` has the channel's path, not the node's, so no card counts it.
`model.item` and `effort.item` have the item's path
(`nodes.<id>.forEach.items.<n>`), so no field shows them: only the node's card
counts them. Each problem keeps its icon and words; color is not the signal.
With the Builder's choices, `forEach.order`, `forEach.not-list` and
`forEach.undeclared` can occur only for a path written outside the Builder; an
empty `from` shows `forEach.from-path` until a list is chosen.

## Keys, names and tokens

- **Keys:** nothing custom. Every control is a select, text field or button from
  the [component set](./design-components-and-copy.md), so Tab, arrows,
  type-ahead, `Enter`, `Space` and `Escape` are theirs; Tab follows page order.
- **Accessible names:** the group is "For each"; controls are "Run this node",
  "Items", "List from", "Most items" (required), "Most at once", "When an item
  fails", "Add a list, for build", "On node", "New list", "Item fields", "Add
  tasks", "Cancel". A problem is tied to its control by description, and the
  select's "(not offered)" is part of its option name.
- **Tokens:** none new. The group, hints, problems and form reuse the Builder's
  existing classes and components, so no pairing is added to
  [pairings.ts](../../packages/ui/test/pairings.ts).
