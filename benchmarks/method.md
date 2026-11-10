# How the benchmarks are measured

The numbers come from scripts in [`tools/benchmark/`](../tools/benchmark/), not
from anyone's reading of a run, and every one is in each benchmark's
`summary.json`.

## A run

A benchmark is one Ork run and every run it called (a `start` run with the
`plan` and `build` runs it started counts as one). The scripts read a copy of
Ork's local store, `~/.ork/state.db`: the runs, their events, the questions they
asked, and one usage row per Claude session.

- **Cost** is the sum of each session's cost as Claude Code reports it, at API
  list prices. These runs used a Claude subscription, so this is what the same
  work would cost on the API, not what was paid.
- **Tokens** are each session's own: input, output, prompt-cache reads and
  prompt-cache writes.
- **Working time** counts only minutes when at least one of the run's nodes was
  working: not a human gate, not a node waiting on a question or permission
  prompt of its own, not a leader waiting on a child that is waiting, and not a
  call waiting on the run it started. **Waiting time** is the rest of the wall
  time, almost all of it the maintainer away from a question. Both are reported,
  with **wall time** beside them.
- **The Ork version** is the one the runs recorded when they started or resumed.
  Runs from before Ork recorded it ran from source, so their version is
  `packages/cli/package.json` at the commit they started from, which
  `summary.json` names.
- **The change** is the commit the run produced. When the maintainer committed
  it by hand, because the run stopped at its last step or didn't commit, the
  benchmark says so.

## The manual baseline

What would the same change cost in a plain Claude Code session, with no Ork?
Running every feature twice would double the cost, so the baseline is estimated
from the history of this repository instead.

- **The data:** the transcripts of the plain Claude Code sessions in which this
  repository was developed by hand, on the same machine with the usual setup
  (project instructions, MCP servers, memory and subagents). Each is split into
  push windows: from one `git push` to the next.
- **Each window** gives a cost (the session's messages at API prices, fitted to
  the totals Claude Code recorded) and working minutes (from each prompt to the
  session's last event before the next), against the lines its pushed commits
  changed. Lock files, generated files and changelogs don't count.
- **The rate** is the cost and minutes per 1,000 changed lines, as quartiles
  weighted by lines. The middle half of the windows sits between p25 and p75.
- **Each benchmark's estimate** applies that rate to the lines its own commit
  changed.

Only the aggregates are published (`results.json`'s `manual_rate`): counts and
quartiles, never a session, a window or a date.

## Caveats

- **Lines are a weak measure of work.** A rename is cheap per line, a subtle
  engine fix is dear, so the manual range is wide.
- **The manual side includes planning.** Its windows hold design talk and
  planning as well as building, so it is likely a little high; an Ork run's plan
  was written before it started.
- **Time is not one to one.** A manual session does one thing at a time, and
  counts a wait on a permission prompt inside a turn; Ork's builders run in
  parallel, and its waits are left out.
- **Quality is not scored.** Every Ork run has an independent review that can
  send the work back; the manual commits passed the same pre-push checks, with
  no separate review.
- **Few runs, one codebase, one maintainer.** These are early alpha runs on Ork
  itself. They show where Ork's costs come from, not what every project will
  see.
