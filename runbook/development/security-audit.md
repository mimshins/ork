# Auditing Ork's security

## When to use

- You want a security audit of this repository: before a release, after a large
  change to the server, the runtime or the release jobs, or on a schedule you
  keep.
- An audit has finished and you need to read its report, or turn a real finding
  into a private advisory.

The `audit` workflow (`.ork/workflows/audit.ork.yaml`) is this repository's own;
it is not shipped. It runs free scanners first, then the six phases of the
vendored [security-audit skill](../../.ai/skills/security-audit/SKILL.md)
(pinned, see its [PROVENANCE.md](../../.ai/skills/security-audit/PROVENANCE.md))
as Ork nodes. What it leaves simpler for now is in
[the audit's limits](../../specs/gaps/audit-limits.md).

## Run it

Run it with a released Ork, as the other workflows
([CONTRIBUTING.md](../../CONTRIBUTING.md#running-orks-own-workflows)), on the
maintainer's go: a run is paid.

```sh
ork run audit                                      # quick, the whole repository
ork run audit --input profile=standard             # a wider pass
ork run audit --input scope="packages/server packages/runtime"
ork run audit --input scope=diff:v0.3.0            # the files changed since a ref
```

| Input     | Values                                                       | Default |
| --------- | ------------------------------------------------------------ | ------- |
| `profile` | `quick` (8 hunters) or `standard` (20 hunters and a recheck) | `quick` |
| `scope`   | `all`; repository paths separated by spaces; or `diff:<ref>` | `all`   |

An input is a plain string, so the first node, `scan`, checks both before
anything else. `--input profile=fast` fails there, naming the allowed values
(`quick`, `standard`), with no session started and nothing spent. A scope path
must stay inside the checkout: no absolute path, no `..`.

**What it costs.** Each agent node has its own `budgetUsd`, and each `forEach`
gets at most the profile's count, so the most a profile can spend is a sum, not
a run cap (the run's cap is 80, the larger profile's, because a cap can't follow
an input):

| Node      | Budget each | `quick` | `standard` |
| --------- | ----------- | ------- | ---------- |
| `recon`   | $4          | 1       | 1          |
| `hunt`    | $2          | 8       | 20         |
| `critic`  | $1.50       | 1       | 1          |
| `verify`  | $0.50       | 12      | 30         |
| `recheck` | $0.50       | 0       | 20         |
| `report`  | $1.50       | 1       | 1          |
| **Most**  |             | **$29** | **$72**    |

`tools/audit/test/workflow.test.ts` keeps the file's numbers and these sums
true. Models: Opus for `recon`, `hunt` and `verify`; Sonnet for the rest.

## What runs

Every agent node is `readonly`, reads
[the read-only Bash rule](../../.ork/context/read-only-bash.md), and only
`tool.shell` nodes touch the output folder. **Nothing audited is run**: Ork has
no OS-enforced sandbox yet, so a lead that needs execution is recorded as
`needs_validation` with the skill's safe plan.

1. `scan` (free): `pnpm audit` (needs the network), every workflow under
   `.github/workflows` (actions pinned by SHA, `permissions` per job, no
   `pull_request_target` with a checkout), and a secret-pattern scan of tracked
   files (file, line and pattern name, never the value; a test's placeholder,
   such as an alphabet run or a key block's header with no key, is left out). It
   also reads the previous audit.
2. `recon` maps the architecture and lists coverage-ledger units, most important
   first. `ledger` writes the ledger and runs `validate-coverage-ledger.cjs`:
   the first 8 (`quick`) or 20 (`standard`) units are hunted, the rest are
   written as `deferred`.
3. `hunt`: one Opus hunter per unit, three at a time. `critic` looks for gaps;
   no second wave runs, so each gap it accepts is recorded `deferred`.
4. `consolidate` dedupes candidates by fingerprint and passes on at most 12
   (`quick`) or 30 (`standard`). The rest are written as `needs_validation`
   saying they were **not looked at**, and the run is marked incomplete.
5. `verify`: a fresh Opus verifier per candidate tries to disprove it, and
   returns `confirmed`, `needs_validation` or `rejected`. Only `confirmed`
   records have a severity. The agent that found a candidate never verifies it.
6. `findings` writes `findings.json` and runs `validate-findings.cjs`. Agents
   list a trace in order and Ork labels each entry's kind from its place (the
   first `entrypoint`, the last `sink`), so a mislabelled trace costs nothing. A
   verifier record that is missing or invalid is kept out and listed as
   unverified. Every candidate past the verifier cap is also validated alone: a
   malformed one lands in `unverified.json` and not in `findings.json`.
   `findings` never rewrites `unreviewed.json`, so a rerun or resume does not
   lose that candidate; `finalize` and `report` skip the rows of
   `unreviewed.json` whose fingerprint `unverified.json` holds. Otherwise a
   rerun would drop the malformed candidate and mark the run `complete`.
7. `recheck` (`standard` only): a fresh agent per confirmed record. A record it
   does not verify is removed and listed as disputed. Under `quick` the verifier
   already did this check.
8. `finalize` applies that (a rerun unions the existing `disputed.json`, so it
   gives the same counts and never marks the audit `complete`), `report` writes
   the posture and notes, and `write` writes the three reports.
9. `review`, a gate: `done` keeps the folder, `discard` deletes it.

A run stops if a validator fails, with its message. `ork resume` goes on from
there.

## Where the report is

Under `~/.ork/audits/<project>/<run-id>/`, outside the checkout (`<project>` is
the main checkout's folder name):

| File                   | Holds                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `REPORT.md`            | Run, posture, confirmed findings, leads, scanner results, coverage |
| `FINDINGS-DETAIL.md`   | Each confirmed finding of medium severity or above, in full        |
| `NEEDS-VALIDATION.md`  | Each lead with its blocker and bounded plan; no severity           |
| `findings.json`        | The final records, in the skill's schema                           |
| `coverage-ledger.json` | The units, and whether each was hunted or deferred                 |
| `run-metadata.json`    | Profile, scope, source ref, `run_status` and why it is incomplete  |

`git status` stays clean after a run. Read `REPORT.md` first: its first section
says what the run could not do.

**A `quick` run is a partial pass**, and the report says so: it hunts the top 8
units and defers the rest, and one run finds only part of what is there. A run
is also marked incomplete when candidates went unreviewed past the verifier cap,
had no usable verifier record, or were disputed at the recheck; the report lists
their fingerprints, and none of them is a finding.

**How the run stops.** The two skill validators run in `tool.shell` nodes with
the default `sh -eu`, so a non-zero exit fails the node: they need no `|| true`
and no `interpreter`. Every edge out of `findings` is gated on `ok`, so a failed
validator stops the run. Both validators ignore `run-metadata.json`, so marking
a run incomplete does not break them. No test makes the skill's own validator
reject a record; a stub validator override would close that.

## Runs build on each other

`scan` prints the previous audit: the newest earlier folder of this project,
with each ledger unit's status and each finding's fingerprint, verdict and
title. `recon` reads it in its prompt. In a ledger, `deferred` means not hunted
(so it ranks first next time) and `planned` means a hunter was assigned; the
hunters' outcomes are not written back
([the gap](../../specs/gaps/audit-limits.md)).

## Keep it out of the repository

This repository is public. The report, ledger and findings are never committed,
posted, attached to an issue or pull request, or published. The gate has no
option that publishes. Also:

- The run's record under `~/.ork` holds the candidates and findings. Make no
  benchmark and no feedback item from an audit run, and never run
  `pnpm benchmark:publish` on it.
- `gh` and `git push` stay denied to the run.

## From a finding to a private advisory

1. Read the record in `FINDINGS-DETAIL.md` and check it yourself against the
   source. A `needs_validation` lead is not a finding: resolve it by its bounded
   local step or owner-observed check first.
2. Open the repository's
   [Security tab](https://github.com/mimshins/ork/security) and choose **Report
   a vulnerability** (or **New draft security advisory**), as
   [SECURITY.md](../../SECURITY.md) describes. Put the record's description,
   trace, conditions and fix in it. It stays visible to the maintainers only.
3. Never open a public issue or pull request for it, and don't paste the report
   anywhere public.
4. The fix is a separate build through `ork run start`, never part of the audit.
   Keep its plan and commits free of exploit details until the advisory is
   published; GitHub's private fork on the advisory is the place to prepare a
   patch that must not be public yet.
5. After the fix lands, close or publish the advisory through GitHub's own flow.
