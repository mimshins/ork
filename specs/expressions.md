# Expressions

Status: **Built** ([parse.ts](../packages/core/src/expr/parse.ts),
[evaluate.ts](../packages/core/src/expr/evaluate.ts),
[tests](../packages/core/test/expr.test.ts)). Why:
[ADR-007](../decisions/ADR-007-safe-expression-language.md).

A small, safe language for an edge's `when:` and for `{{ }}` templates in a
node's `prompt`, `instructions`, `command`, `cwd` and `question`. It has no
assignment, no method calls, no property calls, and no way to reach JavaScript.

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

| Root      | Reads                                                               |
| --------- | ------------------------------------------------------------------- |
| `inputs`  | the run's inputs                                                    |
| `nodes`   | `nodes.<id>.output.<field>`: another node's report                  |
| `output`  | the source node's report (in a `when:`)                             |
| `run`     | run metadata                                                        |
| bare name | in a `when:`, a field of `output`: `verdict` means `output.verdict` |

- A missing path reads as `undefined`; only own properties are read, so
  `x.constructor` or `__proto__` is `undefined`.
- A template reads only `inputs.*`, `nodes.<id>.output.*` and `run.*`.

## Semantics

- `==` and `!=` are strict. `<`, `<=`, `>`, `>=` compare two numbers or two
  strings; anything else is `false`.
- `&&`, `||` and `!` use truthiness: an empty list is false.
- Templates render `undefined` and `null` as empty, numbers and booleans as
  text, and objects as JSON.

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
