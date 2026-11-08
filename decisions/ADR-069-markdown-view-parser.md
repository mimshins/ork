# ADR-069 — Decision text is drawn from a Markdown tree, by Ork's own renderer

- **Status:** Accepted
- **Date:** 2026-11-08
- **Topic:** UI, dependencies, security
- **RFC:** waived — the maintainer accepted the recommended option on 2026-11-08

## Context

The Decisions panel renders a decision's `question`, `context` and `document` as
Markdown ([ADR-068](./ADR-068-gate-document-and-readable-text.md)). That text is
untrusted: it comes from a model's report or a file's content. The panel needs a
Markdown parser, which is a new runtime dependency of `@krapht/ork-ui`.

## Decision

Use
[`mdast-util-from-markdown`](https://github.com/syntax-tree/mdast-util-from-markdown)
2.1.0 (MIT, released 2026-10-03, saved at that exact version, no lifecycle
scripts; `@types/mdast` 4.0.4 as a dev dependency for its types). It parses the
base CommonMark grammar into a tree. Ork's own renderer
(`packages/ui/src/components/markdown.tsx`) maps the tree to React elements, so
no HTML string exists anywhere and nothing in the text can become an element or
an attribute it did not list.

- Only `http:`, `https:` and `mailto:` targets are links (`target="_blank"`,
  `rel="noopener noreferrer"`); any other target shows as text with the target
  beside it.
- An image shows its alt text and is never loaded; raw HTML shows as its own
  source text.
- Tables and task lists are outside the subset and show as their source lines
  (the extensions that parse them are not added).
- A text that fails to render shows as written, with a note.

## Options considered

- **(a) A tree parser mapped to React by Ork's renderer (chosen).** No HTML
  string, no sanitizer, and the allow-list is in the one place that makes
  elements. Cost: our own small renderer, and the parser's few transitive
  packages (the `micromark` family).
- **(b) A parser that produces HTML (`marked`, `markdown-it`) plus a
  sanitizer.** Keeps a raw-HTML surface that a sanitizer's rules must keep
  closed, and adds two dependencies.
- **(c) A hand-written renderer for the subset.** No dependency, but the parsing
  rules of CommonMark (nesting, lists, fences, escapes) are subtle, and a
  mistake here is a security mistake.

## Rationale

The text is untrusted, so the safest shape is the one where an element can only
come from a node type Ork chose to draw. A tree parser gives that without
writing a parser.

## Consequences

- `@krapht/ork-ui` gains `mdast-util-from-markdown` and, through it, the
  `micromark` packages; the UI build's license list picks them up.
- The renderer is ours to keep: a new Markdown feature is a new case in it.
- Tests feed `<script>`, `<img onerror>` and `[x](javascript:alert(1))` and find
  no element, attribute or link from them.
