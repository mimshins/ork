# Expressions

Status: **Built** ([parse.ts](../packages/core/src/expr/parse.ts),
[evaluate.ts](../packages/core/src/expr/evaluate.ts),
[tests](../packages/core/test/expr.test.ts)). Why:
[ADR-007](../decisions/ADR-007-safe-expression-language.md). `item` and `index`
are built in the evaluator and the node types' templates, and the scheduler
gives them a value in each item of a `forEach` node
([RFC-013](../rfcs/archived/RFC-013-for-each.md)).

A small, safe language for an edge's `when:` and for `{{ }}` templates in a
node's `prompt`, `instructions`, `command`, `cwd`, and a gate's `question` and
`document`. It has no assignment, no method calls, no property calls, and no way
to reach JavaScript.

## Grammar

```
expr       := or
or         := and ( "||" and )*
and        := comparison ( "&&" comparison )*
comparison := unary ( ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) unary )?
unary      := "!" unary | primary
primary    := number | string | "true" | "false" | "null"
            | name "(" ( expr ( "," expr )* )? ")"     # a function call
            | path | "(" expr ")"
path       := name ( "." name | "[" ( number | string ) "]" )*
```

- Names are letters, digits, `_` and `-` (node ids may contain `-`).
- Strings use `'…'` or `"…"`, with `\` escaping the next character.

## Scope

| Root      | Reads                                                                 |
| --------- | --------------------------------------------------------------------- |
| `inputs`  | the run's inputs                                                      |
| `nodes`   | `nodes.<id>.output.<field>`: another node's report                    |
| `before`  | `before.<field>`: what a node's `before:` gave; only in its `prompt`  |
| `output`  | the source node's report (in a `when:`)                               |
| `ok`      | in an edge's `when:`, how its source ended, unless it reports `ok`    |
| `run`     | run metadata                                                          |
| `item`    | an item of a `forEach` node: its entry of the list, or `item.<field>` |
| `index`   | an item of a `forEach` node: its place in the list, counted from 0    |
| bare name | in a `when:`, a field of `output`: `verdict` means `output.verdict`   |

- A missing path reads as `undefined`; only own properties are read, so
  `x.constructor` or `__proto__` is `undefined`.
- A template reads only `inputs.*`, `nodes.<id>.output.*` and `run.*`; a tool
  node's `env:` also reads `env.*`, and nothing else may
  ([ADR-047](../decisions/ADR-047-script-identity-env-json.md)).
- `item` and `index` are roots only while an item runs, in that node's own
  `prompt`, `command`, `arguments`, `inputs`, `env`, `cwd` and `ref`. Everywhere
  else, as in an edge's `when:`, a bare `item` or `index` stays a field of
  `output`, so existing conditions read what they read before.
- A `forEach.from` is a template that is exactly one path, and evaluates to the
  value itself, not to text, so a list stays a list
  ([evaluate.ts](../packages/core/src/expr/evaluate.ts), `templateValue`).

## Semantics

- `==` and `!=` are strict. `<`, `<=`, `>`, `>=` compare two numbers or two
  strings; anything else is `false`.
- `&&`, `||` and `!` use truthiness: an empty list is false.
- Templates render `undefined` and `null` as empty, numbers and booleans as
  text, and objects as JSON.
- **Readable mode** is for text a person reads: a gate's `question` and
  `document` only
  ([ADR-068](../decisions/ADR-068-gate-document-and-readable-text.md)). Strings
  stay as they are; a list is `- item` lines; a list of objects is one `- ` item
  per object with its `key: value` lines indented; an object is `key: value`
  lines; `null` and `undefined` stay empty. Text right after a list starts a new
  paragraph, so it does not read as part of the last item. A list or object that
  follows text on the same line starts after a blank line, so it is not glued to
  the label. A value nested deeper than two levels is an indented code block of
  pretty JSON, after a blank line unless it opens the text, never one line of
  raw JSON. A prompt, a tool node's `env:` and every other template keep JSON
  ([ADR-047](../decisions/ADR-047-script-identity-env-json.md)).

## Functions

| Function              | Result                                                             |
| --------------------- | ------------------------------------------------------------------ |
| `any(list, value?)`   | some item equals `value` (or, without `value`, is truthy)          |
| `all(list, value?)`   | the list is not empty and every item equals `value` (or is truthy) |
| `count(list, value?)` | how many items equal `value` (or are truthy)                       |
| `len(x)`              | a string's length, or a list's (anything else: 0)                  |
| `contains(x, value)`  | a string contains a substring, or a list contains an item          |

Example, on a `control.join` (which reports `statuses`):
`when: any(statuses, 'changes_requested')`.
