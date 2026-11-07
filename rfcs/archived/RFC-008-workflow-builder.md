# RFC-008 — A workflow builder that keeps the YAML

- **Status:** Implemented
- **Date:** 2026-11-04
- **Supersedes:** —
- **Superseded by:** —
- **ADR:** [ADR-051](../../decisions/ADR-051-workflow-builder.md)

## Contents

- [Context](#context)
- [Options](#options)
- [Decision](#decision)
- [Consequences](#consequences)
- [Answered questions](#answered-questions)

## Context

A workflow can only be written by hand, or drafted once with
`ork migrate --from-agents`. Nothing in the UI creates or changes one. The
[spec](../../specs/ui.md#workflow-builder) asks for a builder: create a workflow
from scratch, or edit one, on a canvas, with no YAML to write or read, saving
the same files a person would write. It leaves four questions to this RFC.

**What exists:**

- **The server is a client of the store.** It writes the store and its own
  `ui-file`, and no project file. The routes are in
  [contract.ts](../../packages/server/src/contract.ts). Its guards already cover
  every write with the token and the origin check
  ([ADR-039](../../decisions/ADR-039-local-server.md)).
- **The graph only shows.**
  [graph-view.tsx](../../packages/ui/src/graph/graph-view.tsx) pans, zooms,
  selects and moves focus.
  [`layoutGraph`](../../packages/ui/src/graph/layout.ts) places every card from
  the nodes and edges alone, unless a `.layout.json` pins one. Nothing writes
  that file, and no workflow in this repository has one.
- **The canonical serializer drops comments.**
  [`serializeWorkflow`](../../packages/schema/src/yaml.ts) says so, and
  [ADR-006](../../decisions/ADR-006-workflow-file-format.md) records it, adding
  that "a comment-preserving document edit can come later behind the same
  serializer".
- **Validation is in the CLI.** `loadWorkflow` in
  [validate.ts](../../packages/cli/src/commands/validate.ts) composes the
  compiler, project rules, agents, call targets and context checks. The server
  can't import the CLI.
- **The Run dialog starts a saved workflow** through `POST /api/runs`, which
  runs `ork run <file>` detached. A file that doesn't parse is listed with why.

**The format is wide.** There are 13 node types with 4 to 24 fields each, and 13
top-level keys, some deep (`layers`, `rules`, `agents`, `outputs`). A workflow
can also use shorthand edges (`a -> b, c`), flow or block style, anchors and
comments.

**Measured.** With the `yaml` library Ork already uses, `parseDocument` then
`setIn`, `deleteIn` or a list `add`, then
`toString({ lineWidth: 0, indent: 2 })`:

| Probe                                     | Result                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| No edit, on all four example workflows    | Byte-identical                                                              |
| No edit, on a commented hand-written file | Byte-identical, except spaces lining up an inline comment become one        |
| Change a scalar                           | That one line changes; comments stay                                        |
| Change a `\|` block prompt                | Only the changed line differs; it stays a block                             |
| Delete a node                             | Its lines go, with the comment above it; nothing else moves                 |
| Add an edge to the list                   | Existing lines untouched                                                    |
| Replace the whole edge list               | Comments on the old entries are lost                                        |
| Add a key to a canonical file             | The key is appended, and the file is no longer canonical                    |
| Edit a node that has an anchor            | `parseWorkflow` accepts anchors, and the edit also changes the alias's node |

So document edits keep comments and small diffs, with two traps: key order and
aliases.

**Measured: the automatic layout on half-built workflows.** `layoutGraph` gave
identical output for identical input, in about a millisecond for 60 nodes. It
placed all of these without an error: no nodes, one node, nodes with no edges, a
cycle with no `maxRounds`, a self-loop, an edge to a missing node, and a missing
`parent`. Unconnected nodes stack in the first column.

Adding each example workflow's nodes one at a time, in file order, shows how
much the canvas would move:

| Workflow           | Nodes | Steps where an existing card moved | Most cards moved in one step |
| ------------------ | ----- | ---------------------------------- | ---------------------------- |
| `software-factory` | 11    | 4 of 10                            | 2                            |
| `pr-review`        | 7     | 1 of 6                             | 1                            |
| `checked-build`    | 3     | 0 of 2                             | 0                            |
| `across-projects`  | 4     | 0 of 3                             | 0                            |

Adding a node ahead of the first one shifts every card a column to the right.
The order of nodes in the file can also swap cards within a column. That is
still deterministic, as the file sets it.

**Product direction.** The builder should spend no model turns. A real test run
costs money and has real effects, such as commits and `tool.gh` calls.

## Options

### How much of the format the canvas can edit

**A. Curated forms only, for the common fields.** Quick to make look good. Any
other field needs a text editor, which breaks "no YAML to write", and each new
schema field waits for a form.

**B. Forms generated from the schema, with custom controls where they earn it,
and a YAML box for what a form can't show.** The Zod model and its `.describe()`
text already drive `workflow.schema.json`, so a new field shows up without UI
work. Scalars, enums and lists of strings get plain controls. Skills, steps,
`notify:`, options and `inputs` get custom ones. Anything deeper gets a
validated YAML box for that one key. Generated forms need care to read well.

**C. Refuse to open a workflow with fields it can't show.** Honest but useless
for any real file.

**What happens to fields it can't show:** under B or A with document edits,
nothing. A save only touches the paths that were edited, so a field the UI
doesn't know stays as written.

### How edits round-trip through the YAML

**A. Parse to the model and write with `serializeWorkflow`.** No new code, but
it loses every comment and reformats the file on the first save. A hand-written
file would come back as a whole-file diff.

**B. Edit the YAML document, by path.** Each edit is an operation on
`parseDocument`'s tree: a small diff, comments kept, unknown fields untouched.
It needs new code for key order, shorthand edges, aliases and renames.

**C. Rewrite the text with a diff of old and new models.** Fragile, and it
reinvents B's tree.

### Where the edit logic runs

**A. In the browser.** Edits feel instant, but the UI would bundle `yaml` and
the schema, and the logic would exist only there.

**B. On the server.** The browser sends an operation and gets back the new text,
model and diagnostics. On loopback the round trip is small, and the browser
stays free of YAML. Validation has to be on the server anyway.

### How nodes get their positions

**A. Computed from the nodes and edges, every time.** `layoutGraph` already does
this for the Monitor. Nothing to save, drag, sync or merge, and a workflow looks
the same however it was written. Cards can't be arranged by hand, and they can
shift when the graph changes.

**B. Dragged by hand and saved in `<name>.layout.json`,** as ADR-006 planned.
People can arrange what they like, but it adds a file to commit, drag handling
with a keyboard equivalent, updates on every rename and removal, and a second
edge-drawing mode whose edges can cross cards ([L62](../../specs/gaps.md)).

**C. Computed, with optional pins saved in the sidecar.** Keeps hand placement
for those who want it, and all of B's costs.

**D. Dragged by hand and saved in the workflow file.** Every drag is a logic
diff; ADR-006 rejected this.

### Where unfinished work lives

A workflow made from scratch passes through invalid states, and those must not
reach `.ork/workflows/`: a running workflow's `workflow.call` reads its target
when it gets there, and the Run dialog lists what's in the folder.

**A. Only in the browser's memory or `localStorage`.** Nothing to build, but a
closed tab loses it, and browser storage is per origin, while `ork ui` can come
up on another port.

**B. Files in a gitignored `.ork/drafts/`.** Readable, but every existing
project needs a new ignore line, and attached projects need their own path.

**C. A table in the store,** with project, workflow name, text, the hash of the
file it started from, and time. Survives a closed tab and a new port, needs no
ignore line, and works the same for attached projects. A later `ork prune` needs
to know about it.

### How a draft is checked

**A. The real checks, on the server, after each edit.** Move `loadWorkflow`'s
composition into `core` and have the CLI and server share it, so the overlay and
`ork validate` can't disagree. Diagnostics already carry paths, so each can land
on a card or a field.

**B. A lighter check in the browser.** Faster, but it's a second validator.

Run-start checks (programs installed, variables set, MCP servers present) stay
in `ork run`. They're about this machine at this moment, not the file.

### How a draft is test-run

**A. Save, then run it through the Run dialog.** One way to run anything, with a
cost the user already understands. It needs a valid save first. The run is real.

**B. Run the draft itself from a temporary file.** No save needed, but relative
paths resolve from the workflow's folder, and the Monitor and `ork resume` would
point at a file that may be gone.

**C. A simulated run with no sessions.** No cost, but `when:` reads outputs that
only real nodes make, so the user would script every outcome, and Ork would
carry a second way of running that proves little.

## Decision

Accepted, with the maintainer's [answers](#answered-questions) folded in.

**Forms for the whole format, with a YAML box only as a last resort (B, pushed
further).** The UI should stay out of editors, so a person shouldn't meet YAML
in the normal course of building.

- **Generated forms go all the way down.** They walk the schema, so nested
  objects become groups, and lists and records become rows to add and remove.
  Deep keys such as `layers`, `rules` and `agents` get forms this way, with no
  hand-written form for each.
- **Custom controls where a generated one reads badly:** skills, steps
  (`before:`, `verify:`), `notify:`, gate options and inputs.
- **A workflow-level inspector** covers the top-level keys the same way.
- **The YAML box is what's left:** one key at a time, checked like any edit, for
  a value no form can describe. The schema has two free-form values,
  `mcp.call`'s `arguments` and a node's `output.schema`, and both get a custom
  control when the panel ships if one proves workable.
- **The list stays short on purpose.** A test names each path that falls back to
  the box, so adding one is a visible choice, and each is recorded in the
  [gaps register](../../specs/gaps.md).
- Fields the UI doesn't understand, such as one from a newer version, are left
  alone.

**Document edits by path, on the server (B, B).** `packages/schema` gains the
operations:

| Operation                 | What it must get right                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `set`, `delete` at a path | A new key goes at its canonical position, so a canonical file stays canonical                                                           |
| `addNode`                 | Written in block style, canonical order                                                                                                 |
| `removeNode`              | Also removes its edges and channels, and clears `parent` on what it owned; a `{{nodes.x…}}` left in a prompt is reported by the overlay |
| `renameNode`              | Rewrites `parent`, edges, channels, `notify:` targets and `{{nodes.x…}}`                                                                |
| `connect`, `disconnect`   | Edits shorthand in place (`a -> b, c` becomes `a -> c`), adding or removing single entries so comments stay                             |

- **Aliases:** an edit to a node that an anchor or alias shares is refused, and
  says why. Replacing them with plain copies is a later, explicit action.
- **Tests:** after any sequence of operations on a canonical file,
  `serialize(parse(text)) === text`. On a commented file, every comment outside
  a removed node survives.
- **A new workflow** starts from `serializeWorkflow`, so what the builder makes
  from scratch is canonical.
- **A hand-written file keeps its own style.** The canonical serializer stays
  the formatter for what Ork generates, not a rule applied to every save. That
  changes ADR-006's point that every save of a workflow is identical, so a new
  ADR supersedes that part.

**Positions are computed, never saved (A).** The canvas calls `layoutGraph` on
the draft's nodes and edges after each edit, so the builder and the Monitor draw
the same picture. The builder writes no position anywhere.

- **Adding a node** takes a click or a drag from the palette, and where it's
  dropped doesn't matter. It appears unconnected in the first column, then finds
  its place when it's connected.
- **Cards glide to their new places** when the layout changes, instantly under
  reduced motion, and the selected card stays in view.
- **`.layout.json` is retired.** Ork stops reading one, and a file left behind
  is ignored, which the release notes say. With it go `routeDirect`, the two
  layout parsers, the server's reading of the file, and L62, so one workflow can
  only ever be drawn one way. A new ADR supersedes ADR-006's point 3.

**Drafts in the store (C), and only a valid workflow is saved.** Each edit
updates the draft, so nothing is lost. **Save** runs the check, and errors block
it; warnings don't. It then writes the file atomically (temporary file, then
rename) into the project's workflows folder, and clears the draft. It never
commits. If the file changed since the draft began, Save is refused until the
user reloads or chooses to keep their version. Undo is the draft's history, in
the browser, for the session.

**The real checks on the server, after each edit (A).** The `core` function
behind `ork validate` feeds an overlay on the cards and fields, plus a list of
problems.

**Test-run by saving and running (A).** **Run** in the builder saves, then opens
the existing Run dialog on that workflow. No sandbox is implied: it says this is
a real run, and it names the nodes that change things outside the worktree
(`tool.gh`, `tool.aws`, `mcp.call`, `workflow.call`). The workflow's own budget
and any quotas apply; the dialog has no budget field of its own. Trying one node
with `ork run --node`, and showing what a node would be told, belong to the
context inspector's work.

**Keyboard and screen readers get everything.** WCAG 2.2 AA in every theme means
dragging can't be the only way: the palette works with a keypress, and
connecting has a "Connect to…" list in the inspector.

**New server routes**, guarded as today:

- read a workflow's text, model and hash;
- open, edit, and discard a draft (an edit returns text, model and diagnostics);
- save a draft.

Names are checked, and writes stay inside the project's workflows folder,
refusing a symlink that leads out of it.

**Out of scope:** drafting a workflow with a model, editing agents, skills or
`.ork/project.yaml`, several people editing at once, and committing from the UI.

## Consequences

- **The server writes project files for the first time.** Saving a workflow with
  a `script:` means code runs at its next run. It's the same trust as starting a
  run, behind the same token and origin guards, and only reaches the workflows
  folder. [specs/server.md](../../specs/server.md) has to say so.
- **A new store migration** for drafts, and `ork prune` learns about them.
- **`packages/schema` gets document editing,** with the `yaml` library it
  already depends on, so no new dependency. `loadWorkflow`'s composition moves
  to `core`.
- **The graph gains editing** behind props, so the Monitor's view stays
  read-only.
- **Nobody can arrange a workflow by hand.** If the automatic layout draws one
  badly, the fix goes in `layoutGraph`, which improves every workflow. Quality
  has been measured on the four examples and in the probes above, not on large
  real workflows, and how much the reflow distracts can only be judged on the
  canvas. If it turns out to matter, optional pins can come back in a later RFC.
- **A save normalizes one thing in a hand-written file:** spaces that line up
  inline comments become one.
- **Follow-up on ship:** ADR (superseding ADR-006's save rule and sidecar),
  specs for the UI panel, server routes and store, a guide, the map and the
  roadmap.

**Build order**, each landing on its own:

1. Document operations in `packages/schema`, with the round-trip tests. No UI.
2. The shared check in `core`; drafts in the store; the server routes.
3. A builder panel that opens a workflow with its overlay and inspector, and
   edits fields.
4. The canvas: palette, connect, remove, rename, and the reflow.
5. New workflow from scratch, Save, Run.

## Answered questions

The maintainer decided these on 2026-11-04.

1. **Forms first, with a YAML box only as a fallback.** "We have to try to keep
   the UI out of editors." Forms should cover the format, and the box is for
   what's left.
2. **Drafts live in the store.**
3. **Errors block a save.** Warnings don't.
4. **A test run is saving, then a real run** through the Run dialog.
5. **Positions are computed from the nodes and edges.** The maintainer proposed
   this in place of saved positions, as it makes the builder easier to build.

6. **`.layout.json` is retired.** Nothing writes one and this repository has
   none. Keeping it would leave the Monitor a second way of drawing edges, and
   the builder a choice to make about pinned nodes. A hand-written file is
   ignored from then on.

## As built

Where the build moved from the decision above:

- **No YAML box.** Every value got a control. What the format leaves free is
  typed as text, or as JSON for a number or a list, and a test names those
  paths.
- **No drag to connect.** A node connects from a list or by picking a card,
  which works the same by keyboard and pointer.
- **`ork prune` leaves drafts.** It forgets old runs' logs, and a draft is
  unfinished work, which goes only when it's saved or discarded.
- **Untouched lines come back as written.** The measurements missed how much the
  `yaml` library reprints: `[a, b]` as `[ a, b ]`, a file's indent, wrapped
  text, a number's form. So the file is printed before and after the edits, and
  only what differs between those two replaces anything in the original, a
  three-way merge checked by parsing the result. Lines an edit changed are still
  printed the library's way ([L105](../../specs/gaps/limits-builder.md)).
- **Edges are edited in place.** Rewriting a written-out entry lost its comments
  and any field Ork didn't know, and two entries between the same nodes changed
  together. Now only the entry an edit names changes.
