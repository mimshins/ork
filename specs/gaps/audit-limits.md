# Limits found building the `ork:security-audit` workflow

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building the `ork:security-audit` built-in
([the workflow](../../packages/core/workflows/security-audit.ork.yaml),
[its scripts](../../tools/audit/cli.ts), the runbook's
[security audit](../../runbook/development/security-audit.md)). What was left
simpler, or could not be checked:

- **L356 · The audit runs no audited code.** The security-audit skill needs an
  OS-enforced sandbox for that (no network, an empty environment, read-only
  source, writes only to scratch), and Ork has none. Every agent node is
  `readonly` and reads only; a lead that would need execution is recorded as
  `needs_validation` with the skill's safe plan, and a verifier says in
  `observed_result` that a result came from reading the code. A sandbox is a
  later RFC.
- **L357 · A profile's cap is kept by counting.** An input is a `string`,
  `number` or `boolean`, so the format can't limit `profile` to `quick` or
  `standard`: `scan` checks it and fails with the allowed values before any
  session starts. `limits.budgetUsd` and `forEach.maxItems` are plain numbers
  too, so neither can follow an input: `ledger` and `consolidate` limit what
  each `forEach` gets, each agent node has its own `budgetUsd`, and the run's
  cap is the larger profile's (80). `tools/audit/test/workflow.test.ts` keeps
  the sums under each profile's cap.
- **L358 · An agent's output can't nest fields.** An `output.schema` list item
  holds only scalars, so the audit's candidates, units and verifier records are
  `{ list: {} }` (items of any shape), and the shell steps and the skill's
  validator check the shapes. A declared output also holds no object, so
  `scan`'s previous audit and `finalize`'s counts are printed as text as well.
- **L353 · A `tool.shell` node has no stdin.** The audit's structured data (the
  recon units, the hunters' results, the verifiers' answers) rides in
  environment values, which the scripts `unset` after use. A single value over
  about 128 KiB fails to start the child on Linux; macOS limits only the total.
  See also [G13](../gaps.md#gaps).
- **L354 · The audit's ledger records assignment, not coverage.** A hunter
  returns candidates, notes and uncovered boundaries, not the skill's per-unit
  checks, so hunted units stay `planned` (assigned) and the rest `deferred`. The
  next audit learns which units were assigned, not which closed. The critic's
  `missing_units` appear in the report only: `consolidate` can defer a unit the
  ledger has, not add one.
- **L355 · The audit's `standard` profile is one wave.** There is no second
  hunter wave and no final-clean critic, since the workflow is linear; a gap the
  critic accepts is recorded `deferred` under both profiles. `recheck` covers
  `confirmed` records only (the skill's Phase 5 also covers `needs_validation`),
  and a replacement it asks for is never applied: the record leaves
  `findings.json` and is listed as disputed, because no further fresh verifier
  runs.
- **L389 · The advisory scanner reads two lockfiles.** `scan` runs
  `pnpm audit --json` when `pnpm-lock.yaml` exists and `npm audit --json` when
  `package-lock.json` does (pnpm first when both do); with neither, it notes
  that advisories were not checked. Yarn, pip, cargo and go are not read, and a
  scanner that fails or is offline is a note, not a failure. The npm parser
  reads the npm 7+ `audit --json` shape only, and it dedupes by advisory name
  and source, so the per-package vulnerable path is lost.
- **L413 · The verify check reads a scrubbed copy of the record, and checks its
  shape only.** The `verify` node's `verify:` step runs `check-record` on
  `$ORK_REPORT`, which Ork writes with secret-like strings masked
  ([steps](../scheduler/steps.md#checks-on-a-report)), so a field holding one
  reads `[masked]` to the check. It holds the record to `report-schema.json`
  (three tries), not to the facts: a well-formed record can still be wrong. A
  record the session cannot fix fails the node, and `finalize` marks the audit
  incomplete as before.
- **L424 · An attached project's audit sees `HEAD`, not uncommitted changes.**
  In a project attached with `ork register`, `ork run` gives the run a worktree
  of the project's `HEAD` as its root
  ([ADR-100](../../decisions/ADR-100-audit-in-attached-projects.md)), so
  uncommitted changes, and the untracked or ignored files of the checkout, are
  not audited. `scan` notes the audited commit and, when the checkout has
  uncommitted changes, says they are not audited; `scope: diff:<ref>` is a diff
  of `HEAD`. Auditing the working tree needs a snapshot of it or a read grant
  (RFC-021's option A). An in-repo project audits its working tree as before.
- **L426 · A run root's base and names see no inputs.** `git.base` and the
  worktree name templates are rendered with no inputs for the run root (a
  `shortcut:` in [run-root.ts](../../packages/cli/src/run/run-root.ts)). The
  audit's rules do not use inputs; a built-in with a run root whose rules do
  would need them rendered.
- **L427 · A crash between opening the run root and its `created` event leaves a
  worktree recorded nowhere under `commit: never`.** `ork worktrees` and
  `ork worktrees clean` find a leftover by its `worktree` events or, for the
  default rules, by its `ork/<run>/audit-root` branch; a detached worktree has
  no branch, so a crash in that gap leaves a folder beside the clone only
  `git worktree remove` finds.
- **L428 · A failed removal of the run root can print its error twice.** When
  removing the worktree fails at the end of a run, the message can be printed by
  more than one end path; the folder stays and `ork worktrees clean` removes it.
- **L429 · Worktree nodes nested under a run root are untested.** The audit has
  none. A node with `isolation: worktree` in a run whose root is a worktree is
  named from the run root's folder; no test covers that combination.
