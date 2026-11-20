# The Builder: what the checks say for each, and its names

_Part of [The panels](./panels.md)._

Status: **Built** (RFC-013, run 2). Continues
[the Builder: running a node once per item](./panels-builder-for-each.md).

## Contents

- [What the checks say, and where](#what-the-checks-say-and-where)
- [Keys, names and tokens](#keys-names-and-tokens)

## What the checks say, and where

The checks are the compiler's ([for each](../scheduler/for-each.md)). The
Builder adds no checks of its own; it shows each where its path points, as it
does now (`context.problems`), and counts it on the card ("1 error", "1
warning").

| Code                  | Shown under                       | Is                                                                        |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `forEach.from-path`   | List from                         | error                                                                     |
| `forEach.order`       | List from                         | error                                                                     |
| `forEach.not-list`    | List from                         | error                                                                     |
| `forEach.undeclared`  | List from                         | warning                                                                   |
| `item.outside`        | the field that reads it           | error                                                                     |
| `item.field`          | the field that reads it           | error                                                                     |
| `model.template`      | Model                             | error                                                                     |
| `effort.template`     | Effort                            | error                                                                     |
| `ref.*`, `template.*` | Model or Effort, if it reads them | error (`template.not-upstream` and `ref.field` on an agent node: warning) |
| `model.item`          | the node's card only              | error                                                                     |
| `effort.item`         | the node's card only              | error                                                                     |
| `forEach.continue`    | Isolation                         | error                                                                     |
| `forEach.unreached`   | Owner                             | error                                                                     |
| `forEach.owner-order` | Owner                             | error                                                                     |
| `forEach.notify`      | the rule's To, on the notifier    | error                                                                     |
| `forEach.channel`     | Messages, with the workflow's own | error                                                                     |

`model.template` and `effort.template` now mean `item` or `index` read off a
fanned node, or a template in `defaults`. An unknown input, node or field
(`ref.input`, `ref.node`, `ref.field`) or a node that does not run first
(`template.not-upstream`) shows under the field at `nodes.<id>.model` or
`.effort`, as it does under a prompt.

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
  tasks", "Cancel". A problem is tied to its control: while a field has one, its
  control has `aria-invalid="true"` and an `aria-describedby` that lists the
  control's hint, then the problem's lines, so a screen reader reads why a value
  is refused when the control is focused (not as a live announcement, and the
  problem's icon stays `aria-hidden`). A field makes one id for its problem and
  wraps the lines in one element; each hand-drawn control spreads
  `problemProps(field)` to get both attributes. This holds for every control a
  field draws: the generated text, number, free and choice controls, the
  Builder's own (owner, join count, a gate's answers, the notify target, agent,
  the skills picker, `watch.until`), "List from", "Most items", "Most at once",
  and the declare form's "New list" and "Item fields". A group's own problem (a
  list, record, variant or object) is not tied
  ([L525](../gaps/builder-problems-limits.md)), and none is announced when it
  appears ([L526](../gaps/builder-problems-limits.md)), except the "Most items"
  and "Most at once" counts, whose problem sits in a `role="alert"` region: they
  are announced when they appear and read again on focus, unlike another
  field's. A variant field draws a nested field for the same path, so its
  problem lines are drawn twice (the outer copy has no id nothing refers to; the
  inner one is tied); that is older than this tie and harmless to a screen
  reader. The select's "(not offered)" is part of its option name.
- **Tokens:** none new. The group, hints, problems and form reuse the Builder's
  existing classes and components, so no pairing is added to
  [pairings.ts](../../packages/ui/test/pairings.ts).
