# ADR-092 — `ork once --on`: a check keyed by the files it reads

- **Status:** Accepted
- **Date:** 2026-11-15
- **Topic:** CLI, core, project rules
- **Extends:** [ADR-082](./ADR-082-check-once-keyed-by-files.md)
- **RFC:** waived — the maintainer decided this directly on 2026-11-15

## Context

[ADR-082](./ADR-082-check-once-keyed-by-files.md) keys a pass by the whole
working tree, so a one-line edit to a spec reruns the full test suite, 150 to
250 s of it, though no test reads a spec. Builders ran the checks 30 to 48 times
per build, and most edits were to docs.

## Decision

- **`ork once` takes a repeatable `--on <pathspec>`.** Git pathspecs, relative
  to the current folder, that the check depends on. Only the files they match
  key the pass. No `--on` means the whole tree, as before.
- **The key is a hash of `git ls-files -s -z --full-name -- <pathspecs>`.** It
  runs against the temporary index after `git add -A`, so tracked and untracked
  files count, ignored ones do not, a deletion changes the listing, the stat
  cache is kept, and pathspec magic (`:(exclude)…`) works. The hash is stored in
  the pass's `tree` field. The pass's file name hashes `[name, files, node, on]`
  with `on` only when given, so passes made without it stay valid and a
  different list never shares one.
- **A pathspec git rejects is a usage error.** `OncePathspecError`, exit 1,
  git's message, and the command does not run. It is never a silent hit.
- **Only the tests step of `check:all` is wrapped,** with an **exclude** list:
  the paths no test reads (`specs`, `decisions`, `rfcs`, `runbook`,
  `benchmarks`, `.changeset`, most of `docs`, the root READMEs and policy
  files). The outer `check` still keys on the whole tree, so the static checks
  (some of which read docs) always rerun. The list was audited against
  `packages/*/test` and `tools/*/test`.
- **`pnpm check:quick`** (format and lint on the changed files, then both
  typechecks) is the builders' loop between edits; it never records a pass.

## Options considered

- **A workflow field, `once: { on }`.** Ruled out by the maintainer: the format
  would change for one repository's script.
- **A project-config list.** Ruled out: one more place to keep, and the wrap is
  one script.
- **An include list.** Ruled out: a new folder a test reads would be skipped
  wrongly; with an exclude list a new folder reruns the tests.
- **Keep the whole-tree key and make the suite cheaper only.** Done too
  ([the spec](../specs/check-once.md#a-cheaper-suite)), but a docs edit would
  still run it.

## Rationale

A test reads files; naming the paths none reads is a small, auditable list, and
`git ls-files` already does the matching, with the stat cache. The wrong answer
(a skipped test that should run) needs a test that reads an excluded path, which
the audit rules out today and [L374](../specs/gaps/check-once-limits.md)
records.

## Consequences

- A docs-only edit prints the tests' "already passed" line; an edit under
  `packages/` reruns them.
- Nothing enforces the list as tests change
  ([L374](../specs/gaps/check-once-limits.md)); the `docs/guides` entry is a
  glob ([L375](../specs/gaps/check-once-limits.md)).
- `check:quick` can pass what `check:fast` fails
  ([L376](../specs/gaps/check-once-limits.md)).
- Repeated `--covers` now records a pass for every name: the CLI reads every use
  of a repeated flag, where citty kept only the last.
- No workflow-format or `schemaVersion` change, no new dependency.
