# Benchmarks

Ork is built with Ork. Every feature in this repository goes through Ork's own
workflows ([`.ork/workflows/`](../.ork/workflows/)): a spec, builders working in
parallel in their own git worktrees, an independent review that can send the
work back, a docs pass, and a gate where the maintainer decides what ships. Each
benchmark here is one of those runs, measured from Ork's own records: what it
cost, how long it worked, how long it waited for a person, what went wrong, and
the commit it produced.

They are real changes to a real codebase, not tasks chosen to look good. Runs
that failed, and runs where Ork came out dearer than a person working in Claude
Code by hand, are here too.

## What they show so far

Nine runs, 2026-11-08 to 2026-11-16, Ork 1.0.0-alpha.1 to alpha.21: eight that
built a change, together 44,895 changed lines, and one QA pass that changed none
($2.26 for eight surfaces in 28 minutes). The figures below are the eight
builds':

- **Large changes cost less, or the same.** Of the five changes over 4,000
  lines, four cost 32–45% less than the same change is estimated to cost in a
  plain Claude Code session, and one (11,097 lines) cost about the same, after
  three Ork bugs that were fixed afterwards. Across all eight, Ork spent $154.19
  against a manual median of $203.18, 24% less.
- **Small changes cost more.** Under about 1,200 changed lines, Ork's spec,
  review and docs steps are a fixed cost that a quick manual session skips: it
  spent 15–37% more there, though still inside the manual range.
- **The minutes are unattended.** Ork's working time was below the manual
  estimate's (535 against 682 minutes), and a manual session needs someone at
  the keyboard throughout. An Ork run needs the maintainer only at its gates and
  questions: outside the first run, 31 minutes in all. The first run waited over
  two hours, on 33 permission prompts that later versions removed.
- **The review earns its keep.** Six of the eight runs had their first build
  sent back by Ork's reviewer, with findings up to a feature that never actually
  loaded and a deadlock that validation only warned about; each was fixed before
  anything shipped.
- **Each run makes Ork better.** Every run so far exposed something in Ork:
  builders colliding on git's index, a worktree removed too early, a budget
  passed by sessions started side by side, a review after a resume reading the
  wrong checkout. Each was fixed before the next run, and each benchmark's
  README says how.

Where the savings come from: each builder starts a small, fresh session from a
brief, not a long transcript; what Ork adds to a prompt is ordered so sessions
share Claude's prompt cache (97% of all input tokens were cache reads); routine
work runs on Sonnet and only the engine work on Opus; and builders run side by
side.

## Results

<!-- results:start -->

| Benchmark                                            | Ork            | Status    | Changed lines | Ork cost | Manual cost: median (p25–p75) | Ork working min | Manual min: median (p25–p75) |
| ---------------------------------------------------- | -------------- | --------- | ------------: | -------: | ----------------------------: | --------------: | ---------------------------: |
| [canary-experiments](./canary-experiments/README.md) | 1.0.0-alpha.1  | failed    |           960 |    $5.94 |           $4.34 ($2.84–$6.72) |              29 |                    15 (9–37) |
| [node-mcp](./node-mcp/README.md)                     | 1.0.0-alpha.3  | succeeded |         1,115 |    $5.79 |           $5.05 ($3.30–$7.81) |              29 |                   17 (10–43) |
| [readable-gates](./readable-gates/README.md)         | 1.0.0-alpha.4  | failed    |         4,294 |   $11.75 |        $19.43 ($12.71–$30.06) |              71 |                  65 (38–167) |
| [leader-fixes](./leader-fixes/README.md)             | 1.0.0-alpha.5  | succeeded |           755 |    $4.30 |           $3.42 ($2.23–$5.29) |              24 |                    12 (7–29) |
| [for-each-run-1](./for-each-run-1/README.md)         | 1.0.0-alpha.6  | succeeded |         8,065 |   $20.07 |        $36.50 ($23.87–$56.47) |              61 |                 123 (71–314) |
| [cli-drivers-only](./cli-drivers-only/README.md)     | 1.0.0-alpha.9  | failed    |        11,097 |   $50.32 |        $50.22 ($32.84–$77.69) |             150 |                 169 (98–431) |
| [follow-ups](./follow-ups/README.md)                 | 1.0.0-alpha.14 | succeeded |        11,190 |   $34.26 |        $50.64 ($33.12–$78.34) |              98 |                 170 (99–435) |
| [qa-alpha-14](./qa-alpha-14/README.md)               | 1.0.0-alpha.14 | succeeded |             — |    $2.26 |                             — |              28 |                            — |
| [onboard](./onboard/README.md)                       | 1.0.0-alpha.21 | succeeded |         7,419 |   $21.77 |        $33.58 ($21.96–$51.94) |              74 |                 113 (65–288) |

The manual columns apply a rate measured over 147 pushes in 5 plain Claude Code
sessions on this repository (220 commits, 194,244 changed lines): $4.53
($2.96–$7.00) and 15 (9–39) working minutes per 1,000 changed lines.
[How](./method.md#the-manual-baseline).

<!-- results:end -->

Costs are what Claude Code reports at API prices; the runs used a Claude
subscription, so they are an API-equivalent measure, not a bill. Working time
leaves out every minute a run waited on the maintainer. The manual estimate is a
rate from this repository's own history, applied to each change's size, with a
wide range. [Method and caveats](./method.md).

[The suite's cost](./method.md#the-suites-cost): what the test suite costs in
CPU, before and after it was made cheaper.

## In each benchmark

- `README.md`: what was built, the numbers, how the run went and what went
  wrong, and the comparison with a manual session.
- `summary.json`: every number, by node and by activation, and the Ork version
  that ran it.
- `usage.csv`: one row per Claude session: model, cost, tokens, turns, time.
- `inputs/`: what the run was asked, and the workflow, project rules and agent
  files exactly as the run read them.

Not published: session transcripts, prompts, the plan text a run was given, and
anything from the maintainer's machine. `pnpm benchmarks:check` (part of
`pnpm check`) keeps paths, emails, tokens and other private data out of this
folder.

## Run your own

The same tools measure any Ork run on your machine, from Ork's store, without
sending anything anywhere:

```sh
pnpm benchmark <run> <folder>      # measure a finished run and the runs it called
pnpm benchmark:control <folder>    # estimate the same changes in plain sessions
pnpm benchmark:publish <folder>    # copy the safe parts into benchmarks/
```

The [benchmark-run](../.ai/skills/benchmark-run/SKILL.md) skill walks through
all three.
