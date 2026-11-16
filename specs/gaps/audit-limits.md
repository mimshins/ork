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
- **L388 · The audit works only in an `ork init` project.** The agents are
  `readonly` and read the bundle's files (the skill, the read-only rule) from
  `.ork/runs/.builtin/<hash>/` in the project. In an `ork register` project that
  folder is outside the checkout, where a read-only agent cannot read, so `scan`
  (the first node, free) exits 1 naming `ork init` before any agent starts.
  Ruled out for now: a driver read grant for another folder, and writing the
  bundle into the repository
  ([ADR-096](../../decisions/ADR-096-built-in-bundles.md)). A resume and
  `ork validate` are unaffected.
- **L389 · The advisory scanner reads two lockfiles.** `scan` runs
  `pnpm audit --json` when `pnpm-lock.yaml` exists and `npm audit --json` when
  `package-lock.json` does (pnpm first when both do); with neither, it notes
  that advisories were not checked. Yarn, pip, cargo and go are not read, and a
  scanner that fails or is offline is a note, not a failure. The npm parser
  reads the npm 7+ `audit --json` shape only, and it dedupes by advisory name
  and source, so the per-package vulnerable path is lost.
