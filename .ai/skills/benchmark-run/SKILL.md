---
name: benchmark-run
description: Save a benchmark of a finished Ork run, and every run it called, into a folder - cost, tokens, working and waiting time, by node, what went wrong - and compare it with an estimate of the same change made in plain Claude Code sessions. Use when asked to benchmark a run. Arguments - the run id, the folder to save into, and optionally a name.
argument-hint: <run> <folder> [name]
---

# Benchmark a run

Arguments: `$ARGUMENTS`, which are a run id (or prefix), the folder that holds
the benchmarks, and an optional name. If the run or the folder is missing, ask
for it. Never guess the folder.

The numbers come from scripts, not from you: `pnpm benchmark` measures and
`pnpm benchmark:control` estimates the control (`tools/benchmark/`, whose files
say how). Your part is the name, the result commits when a run committed none
itself, and the README's account of what happened.

## Rules

- **Working time** leaves out every minute the run waited on the maintainer:
  gates, `workflow.call` nodes waiting on their run, a node blocked on its own
  open question or permission prompt, and a leader waiting on a child that is
  blocked. Wall time and waiting time are reported beside it, never instead of
  it.
- The run's whole call tree is one benchmark: a `start` run with the `plan` and
  `build` runs it called.
- The scripts read a consistent copy of `~/.ork/state.db`. Never write to the
  store.
- A benchmark folder is never overwritten. Pick another name.

## Steps

1. **Check that it ended.** Run `pnpm ork ps --all` and find the run. If it is
   still `running` (or waiting at a gate), say so and stop; benchmark it once it
   ends.
2. **Name it.** Use the name given. Otherwise take a short kebab-case name for
   the work: the plan's file name in `.ai/plans/`, or a few words from the
   brief, such as `cli-drivers-only` or `for-each-run-2`. Say which name you
   chose.
3. **Measure:**
   ```sh
   pnpm benchmark <run> <folder> --name <name>
   ```
   This writes `<folder>/<name>/` with `summary.json`, `usage.csv`, `brief.md`,
   `spec.md` (the plan or spec that was built) and `workflow/` (the workflows,
   `project.yaml` and agents at the commit the run started from).
4. **Result commits.** `summary.json`'s `result_commits` lists the commits the
   run's tool nodes printed (a `publish` step). If it is empty because the
   maintainer committed the change by hand, find that commit with
   `git log --since=<run start>` and its diff, and confirm it with the
   maintainer. Then add it to `result_commits` in `summary.json`. If nothing was
   kept, leave it empty: the control then has no row for this run.
5. **Control:**
   ```sh
   pnpm benchmark:control <folder>
   ```
   This rewrites `<folder>/CONTROL.md` and `control.json` for every benchmark
   in the folder, with this run's row among them.
6. **What happened.** Read `pnpm ork logs <id>` for each run in the tree
   (`summary.json`'s `runs`), and `summary.json`'s `activations`, to find:
   failed sessions and why (turn cap, budget, an error, an Ork bug), review
   rounds, what each permission request asked, conflicts, and how builders
   overlapped (from the activations' starts and minutes, by owner).
7. **Write `<folder>/<name>/README.md`** in this shape:
   - `# Benchmark: <name>`, then one paragraph: what the run built, the runs
     (id and workflow), the date, the Ork version (`pnpm ork --version` at the
     time, or the latest release before the run), the driver, and the result
     commit with its stat (`git show --shortstat`).
   - `## Totals`: a two-column table with status, cost (and each run's cap from
     its workflow's `limits.budgetUsd`), all tokens and each kind, turns,
     sessions and failed sessions, working, waiting and wall minutes, decisions
     and permission requests.
   - `## By node`: a table from `by_node`, with node, model, sessions, cost,
     input, output, cache read and cache write.
   - `## Builders` (for a run with a leader): when the builders ran, how many
     at once, and which tasks each wave held.
   - `## What went wrong`: one bullet per problem, each saying whether Ork,
     the agent or the workflow caused it, and the fix if one was made. Write
     "Nothing" when nothing went wrong.
   - `## Against a manual session`: this benchmark's row from `CONTROL.md`, and
     one sentence reading it. Link `../CONTROL.md` for the method and caveats.
   - `## Files`: what each file in the folder holds.
8. **Report** the headline numbers to the maintainer (cost, working, waiting and
   wall minutes, the control's median and range), and anything that went wrong.
