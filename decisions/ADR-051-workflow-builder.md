# ADR-051 — A workflow builder that keeps the YAML

- **Status:** Accepted
- **Date:** 2026-11-04
- **Topic:** UI / workflow format
- **RFC:** [RFC-008](../rfcs/archived/RFC-008-workflow-builder.md)
- **Supersedes:** in [ADR-006](./ADR-006-workflow-file-format.md), that a save
  goes through the canonical serializer (point 2, for edits) and the layout
  sidecar (point 3)

## Context

A workflow could only be written by hand. The builder had to let a person make
one from scratch in the UI, with no YAML to read, and still leave the same file
a person would write, with its comments, in git, where it works with every `ork`
command.

## Decision

**Edits work on the YAML document, by path, on the server.** Each takes a
workflow's text and gives its new text, all or none, and a three-way merge keeps
every line it didn't have to change as written: comments, style and fields Ork
doesn't know stay. A new key goes where the serializer would put it, so a
canonical file stays canonical. A rename follows every reference in the file,
reading expressions as the expression language does. An edit through a shared
YAML anchor is refused.

**Forms come from the format's JSON Schema, all the way down.** A new field or
node type needs no UI work. The builder has its own controls for owners, message
targets, agents and skills. A value the format leaves free is typed as text, or
as JSON for a number or a list, so no YAML box was needed: the maintainer wanted
the UI to stay out of editors, and a test names every such path.

**Positions are computed, never saved.** The canvas uses the Monitor's layout, a
pure function of the nodes and edges. Nothing is dragged, and `.layout.json` is
retired: Ork no longer reads one, and a file left behind is ignored.

**Drafts live in the store,** not the workflows folder, because a draft passes
through invalid states and a running workflow's call must never read one. They
survive a closed tab and a new port.

**Errors block a save.** Save runs the same checks as `ork validate`, which
moved into `core` so the two can't disagree. It writes the file whole, never
commits, and asks before replacing a file that changed since the draft began,
including when undo would put back older text. The builder reads and writes only
inside the project, with links resolved, and never writes through one.

**A test run is a real run:** Run saves, says so, names the nodes that act
outside the worktree, and opens the Run workflow dialog.

## Options considered

From RFC-008, in full there:

- **Saving:** the canonical serializer (loses every comment on the first save);
  rewriting text from a diff of two models (reinvents the document tree).
- **Forms:** curated forms for common fields (each new field waits for one); a
  YAML box per deep key (puts an editor back in the UI).
- **Positions:** dragged and saved in the sidecar (a file to commit, updates on
  every rename, and a second way of drawing edges that could cross cards);
  optional pins (all of that, for those who want it).
- **Drafts:** browser storage (lost with the tab or the port); gitignored files
  (a new ignore line in every project).
- **Test runs:** running an unsaved draft (paths resolve from its folder, and
  `ork resume` would point at a file that may be gone); a simulated run (`when:`
  reads outputs only real nodes make).

## Rationale

Measured on the example workflows, document edits changed only the edited line
and left an unedited file byte-identical. Automatic layout handled every
half-built shape tried, and moved few cards as a workflow grew, so saving
positions would have cost more than it gave.

## Consequences

- The server writes a project's files for the first time, behind the same token
  and origin guards as every write. A saved `script:` runs at the workflow's
  next run, the same trust as starting one.
- A new store migration holds drafts; `ork prune` leaves them.
- L62 is gone, as edges always take the routed path.
- Limits: [L103 to L111](../specs/gaps/limits-builder.md).
