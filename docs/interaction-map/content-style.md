# Content style

How to write the cards, connections and journeys. The shapes are in
`public/js/data/types.js`; this is about what goes in them.

## Voice

- Plain, short, factual sentences. Say what a thing does and why it exists.
- Present tense for what is true today; mark a status for what isn't built.
- No marketing words ("seamless", "robust", "powerful"), no hedging filler.
- Names, paths, commands, fields, events, functions: in `backticks`.
- American spelling.

## Nodes (cards)

| Field     | Write                                                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`   | The name people use for it. ≤ ~22 characters.                                                                                                                        |
| `sub`     | One line: where it is or what it does, e.g. `` `ClaudeRuntime` · `Session` ``. ≤ ~30.                                                                                |
| `summary` | 2–3 sentences: what it is, why it exists, the one thing to know.                                                                                                     |
| `facts`   | 2–5 bullets: what it holds, owns, guarantees, how it is configured. One fact each.                                                                                   |
| `see`     | The same thing on other maps.                                                                                                                                        |
| `docs`    | 1–4 links, most specific first: the code, the test, the design section.                                                                                              |
| `pkg`     | The Ork package its code lives in (`schema`, `core`, `runtime-claude`, `nodes`, `server`, `cli`, `ui`), or `null` for people, outside tools and services, and files. |
| `src`     | Optional: the directory or file its code lives (or will live) in; the check uses it to flag statuses to review.                                                      |

## Statuses

Pick the status the repository supports today:

- `built`: in the code on `main`, with tests. The check requires a doc link into
  `packages/` (or `examples/`) and, if `src` is set, that it exists.
- `partial`: a minimum is built; say in a fact what isn't. For example, a field
  the schema accepts but nothing reads yet.
- `specified`: described in [docs/design.md](../design.md), not built.
- `planned`: designed for a later milestone (the UI and server are milestone 2).
- `external`: someone else's: you, the `claude`, `gh` and `aws` CLIs, Claude
  Code sessions, model providers, the project's own files.

An edge's `status` defaults to `built`; set it whenever either end is not built.
A journey step takes `status` only when the step is not (fully) real.

## Edges

- `label`: a few words of what passes, e.g. `` `start(SessionSpec)` ``,
  `SSE event stream`.
- `detail`: one to three sentences: what happens, and what is refused or fails
  closed.
- `from` is the caller or sender. `both: true` only for genuinely two-way
  traffic, such as a decision and its answer.

## Journeys

- 2–4 per map, 4–12 steps each. `who` names the actors. The summary says where
  it starts and where it ends.
- Each step's title is one line of what happens; the detail says how and why.
- Prefer steps that run along an existing edge; a step with no `to` happens
  inside one card.

## Doc links

`d(path, label)`, or a shared link from `refs.js`. The path is relative to the
repository root and must exist; a `#anchor` must match a heading of that
Markdown file (GitHub's slug). Prefer the smallest thing that answers: the code
file, then the design section. Labels say what the reader finds there.

## Cross-map links (`see`)

Link a card to the same thing on another map:
`{ map: "messaging", node: "bus", label: "The bus in detail" }`. A map-only link
is fine when there's no single card. The check resolves every link.

## Never

No secrets, tokens, keys or personal data. Ork is public, and so is this map.
