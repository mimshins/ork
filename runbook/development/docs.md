# Documentation structure and checks

## When to use

- Adding, moving, or splitting a document under `specs/`, `docs/`, or
  `runbook/`.
- `pnpm docs:check` fails, or a link lands on a document instead of a section.
- Reviewing a change that edits a hub's `## Contents`.

## Layout

A document over 200 lines is a **hub** plus a folder of **chunks**:

```
specs/context.md                # hub: title, intro, "## Contents"
specs/context/layers.md         # a chunk
specs/context/compiler.md       # a long section: a section hub, same folder
specs/context/agents-md.md      # one of the section hub's chunks
```

- One folder level only: chunks and section hubs live directly in `<doc>/`.
  Never create `<doc>/<section>/`.
- A chunk over 280 lines becomes a **section hub**: its own `## Contents`, with
  its chunks as its siblings in the same folder.
- The hub keeps the original path, so links to the document keep working.
- A folder with no hub beside it (such as `runbook/development/`) groups
  standalone documents; each follows the 200-line rule on its own.
- ADRs (`decisions/`) and RFCs (`rfcs/`) are atomic: one decision per file. A
  long one gets a `## Contents`, never a folder.
- `docs/interaction-map/` is an app with its own docs: its links are checked,
  its layout is not.

## Split a document

1. Group the H2 sections into chunks of roughly 150–250 lines. Two adjacent
   short sections may share a chunk; never more than three.
2. Name each chunk after its content, in kebab-case, without a number.
3. Move the section body verbatim. Use `# <section title>` as the chunk's H1,
   then `_Part of [<Hub>](../<hub>.md)._` (or `(./<section-hub>.md)` for a
   section hub's chunk), then the body with every heading promoted one level.
4. Add `## Contents` to the hub: a nested list of chunk links and their
   headings. No summaries.
5. Rewrite every link that pointed at a moved anchor; it now points at the chunk
   that owns it.
6. Run `pnpm docs:check`.

## Add or move a section

- New section: add the chunk, list it in the owning hub's `## Contents`, run the
  check.
- Cross-reference: link the chunk that owns the anchor, not the hub.
- Move text between documents; never copy it. A hub holds no section body.
- Changing a heading changes its anchor: update every `#anchor` link in the same
  change (the interaction map's `refs.js` included).

## Checks

`pnpm docs:check` runs [tools/docs/check.ts](../../tools/docs/check.ts) (fixture
tests in [tools/docs/test](../../tools/docs/test/check.test.ts)) and verifies:

- every relative link in every Markdown file resolves;
- every `#anchor` exists in its target, using GitHub's heading anchors
  (`<a id="…">` counts too);
- under `specs/`, `docs/` and `runbook/`: a document over 200 lines has
  `## Contents` and chunks; every chunk has a hub beside its folder, starts with
  its `_Part of […]._` line, is listed in that hub's contents, and stays under
  280 lines.

It runs in `pnpm check`, the `pre-push` hook, and the CI `docs` job. It skips
`node_modules`, symlinks (checked at their target), local task specs
(`.ai/specs/`), and the map's `public/` app, and it never fetches URLs.
