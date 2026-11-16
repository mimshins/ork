# ADR-096 — Built-in bundles: a built-in workflow with companion files

- **Status:** Accepted
- **Date:** 2026-11-16
- **Topic:** core built-in workflows, `tools/audit`, `ork:security-audit`
- **RFC:** waived: the maintainer decided the shape directly (plan "Ship the
  audit as the built-in `ork:security-audit`"); this ADR records the options
- **Amends:** [ADR-059](./ADR-059-closing-the-feedback-loop.md)

## Context

[ADR-059](./ADR-059-closing-the-feedback-loop.md) ships a built-in workflow as
one text, written to `.ork/runs/.builtin/<hash>/<name>.ork.yaml` and run from
there. The security audit (the repository-local `audit` workflow) cannot ship
that way: its prompts read a vendored skill (`.ai/skills/security-audit/`: phase
docs, a report schema, two validators), its `tool.shell` nodes run
`tools/audit/*.ts`, and its agents read a read-only rule from `.ork/context/`.
All of those exist only in this repository, so the audit worked only here.

## Options considered

- **A. Bundle: companion files written beside the workflow (chosen).** A
  built-in is the workflow text plus companion files, all written under the hash
  folder. Prompts and scripts name that folder, relative to the project root.
- **B. Assets by absolute path.** Ork writes the files once under `~/.ork` and
  the prompts name that path. The read-only agents cannot read outside the
  project, and the driver has no read grant for another folder.
- **C. Inline prompts plus a hidden subcommand.** The phase docs go in the
  prompts and the scripts become an `ork` subcommand. A larger prompt per node
  and a new CLI surface that is not a command a user runs.

## Decision

1. **A built-in is `{ workflow, files? }`.** `files` maps a relative path to its
   text. Core bundles every text (a generated module, as for the workflow text),
   and `builtinWorkflowFile` writes the workflow and each companion file into
   `.ork/runs/.builtin/<hash>/`, by rename, never following a link. The link
   guard of ADR-059 applies to every path; one refused path writes nothing.
2. **The hash covers the whole bundle.** A changed companion file gives a new
   folder; an unchanged bundle is not rewritten; a resume reads the exact bundle
   its run started with.
3. **One placeholder for the bundle folder.** The texts carry it where they name
   a bundled path; at write time it becomes the folder **relative to the project
   root** (`.ork/runs/.builtin/<hash>`). The hash is taken before the
   replacement. `context:` refs use plain paths relative to the workflow file.
4. **The first bundle is `security-audit`** (`ork run ork:security-audit`): the
   workflow, the vendored skill, the read-only rule and the `tools/audit`
   scripts. `.ork/workflows/audit.ork.yaml` is deleted; this repository audits
   itself with the built-in. The bundle's sources stay where they are (the skill
   byte for byte, per its `PROVENANCE.md`); a generator emits the bundle module.
5. **`scan` chooses its advisory scanner by lockfile:** `pnpm audit --json` for
   `pnpm-lock.yaml`, `npm audit --json` for `package-lock.json`, pnpm first when
   both exist, a note that advisories were not checked otherwise. A scanner that
   fails or is offline is a note, never a failure. Yarn, pip, cargo and go are
   not read.
6. **Attached projects are not supported.** In a project registered with
   `ork register`, Ork's files sit outside the checkout and a read-only agent
   cannot read them. `scan`, the first node, exits 1 naming `ork init` when the
   bundle folder is outside the project root, before an agent starts and with
   nothing spent. Recorded as a gap
   ([audit limits](../specs/gaps/audit-limits.md)).
7. **Secret patterns are copied into the bundle.** `scan` needs the list of
   [ADR-091](./ADR-091-shared-secret-patterns-and-scrubber-in-core.md), which
   the bundle cannot import from core. The generator copies
   `packages/core/src/store/secret-patterns.ts` into the bundle and rewrites the
   one import line in `scan.ts` to the sibling file; a test runs the written
   bundle with none of this repository's files.
8. **Reports** stay in `~/.ork/audits/<project>/<run-id>/`; their wording says
   the report "may be sensitive: do not commit or post it", not that a
   repository is public.

## Consequences

- The built-in's text is committed twice: its sources and a generated module of
  about 350 KB, which also grows the CLI bundle by that much. The module is
  separate from the one that holds `ork:feedback-apply`; a staleness test fails
  when it is out of step with its sources.
- Updating the pinned skill now also means regenerating the bundle.
- Ork writes about 350 KB into the project's gitignored run folder on a run; a
  cloned repository that makes `.ork/runs/.builtin` a link is refused, as for
  `ork:feedback-apply`.
- The audit works only in an `ork init` project until a read grant or a safe
  place for the bundle exists.
- Reversible: no stored run, event or workflow-format change; `schemaVersion` is
  unchanged. The bundle shape is the hard-to-reverse part, because a later
  built-in will follow it.

Spec: [built-in workflows](../specs/cli/built-in-workflows.md),
[audit limits](../specs/gaps/audit-limits.md).
