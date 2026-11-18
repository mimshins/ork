# RFC-023 option 5: what shorter builder sessions would save

An estimate of
[RFC-023](../../rfcs/archived/RFC-023-extract-tool-for-session-reads.md)'s
option 5, made on 2026-11-18 from existing data only: no new runs, nothing paid.

## Question

RFC-023 kept option 5 ("shorter sessions or smaller tasks") as a follow-up whose
cost was never measured. The idea: a tool result stays in the session's
transcript and is read again from Claude's prompt cache on every later turn, so
a long builder session pays again and again for files it read early on. If a
long session were split into shorter ones, the later part would not carry that
early weight. It would pay instead to start a new session and to re-read what it
still needs. Does the trade pay off, and where should the split go?

## Data

- **Runs:** all 21 saved benchmark runs of Ork building itself (from 8 to 18
  November 2026), including the large build runs `cli-drivers-only`,
  `follow-ups`, `codex-driver`, `onboard` and `for-each-run-1`. Every session's
  Claude Code transcript was still on disk, so none was skipped.
- **Sessions:** 188 Claude Code sessions. Of those, **63 builder sessions** (the
  `implement*` and `engine*` nodes and the `build` leader) are modelled. Their
  cost is $149.44, 75% of the $200.07 all 21 runs cost.
- **Per turn:** each assistant message's usage (input, cache read, cache write
  with its 5-minute or 1-hour split, output), in order. Here a turn is one API
  call, counted the way `pnpm benchmark:carried` counts it. That is not the
  `turns` column of Ork's usage, nor the unit of a node's `maxTurns`.
- **Prices:** the per-model rates in `tools/benchmark`. Pricing every turn this
  way comes to 102.4% of the cost Ork's store recorded for the same nodes.

## What the sessions look like

| Builder sessions (63)                               | Value                                             |
| --------------------------------------------------- | ------------------------------------------------- |
| Turns: mean, median, p75, p90, max                  | 48, 27, 62, 124, 334                              |
| Sessions over 100 turns                             | 7, holding 63% of cache-read tokens, 44% of cost  |
| Cache-read tokens read in turns past 20 / 40 / 60   | 86% / 71% / 58% (all 188 sessions: 81 / 64 / 49%) |
| Cost split                                          | cache reads 43%, cache writes 30%, output 27%     |
| Sessions that received more than one delegated task | 15, holding 61% of cost and 73% of cache reads    |
| First prompt of a session (median)                  | 36k tokens, 24k of them written to cache          |

Two facts shape the result:

1. **Ork reuses an owned builder's session for each new task.** A builder that
   is delegated a new task resumes its old session. The longest session took 7
   tasks in 334 turns and ended with 734k tokens of context.
2. **A token written to the cache costs 40 cache reads.** Every cache write in
   these sessions is a 1-hour entry, at twice the input price; a cache read
   costs 1/20 of the input price. Every token a new session has to load again,
   whether its instructions or a file it re-reads, must then save 40 later reads
   before the split breaks even.

## Method

For each builder session and each split strategy:

- **Before the split,** turns are unchanged.
- **The new session's first turn** costs what the session's own first turn did.
  The system prompt is read from a cache shared across sessions; the rest is
  written: Ork's instructions, a brief, a **handoff** (2k tokens, also charged
  as output to the closing session) and the **re-read allowance R**. That turn
  also writes its own new content.
- **Each re-read** costs extra turns: one turn per 4 files, at the new session's
  context size.
- **Every later turn** carries D = (old context at the split) − (new starting
  context) fewer tokens. D comes out of cache reads first. On a turn where the
  original missed the cache, it comes out of cache writes. Outputs and new tool
  results are left as they were.

**Strategies:**

| Name       | Where a new session starts                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------- |
| once@k     | after turn k (k = 20, 40, 60), as the brief proposed                                           |
| every k    | every k turns: a turn cap                                                                      |
| tasks      | at each new task Ork delegates into the session (each "New task from `build`" message)         |
| tasks>X    | the same, but only when the context is already over X tokens                                   |
| any-prompt | at any message Ork sends: also "sent back" rounds after a failed check or a review             |
| ctx>X      | as soon as the context passes X tokens, even in the middle of a task (at least 10 turns apart) |
| best-once  | the single best split point in hindsight (an upper bound, not something a policy could pick)   |

**The re-read allowance R** (what the new session has to load again), from low
to high:

- **zero**: nothing. This is the floor.
- **edit**: files read before the split and edited after it with no fresh Read
  first. Claude Code will not edit a file the session has not Read, so this is a
  hard minimum.
- **touch**: files read before the split that a later call names. A file is left
  out when the first later call that names it reads it again, because the
  original session already paid for that re-read. This is the middle estimate.
- **touch-raw**: the brief's own measure, without that correction.
- **all**: every tool result before the split. This is the ceiling.

A result's size in tokens is not counted from its characters. Each turn's
measured context growth is shared among that turn's results by size (median 2.2
characters per token).

**Changes to the brief's method:**

- Added the turn cap, task, context-size and hindsight strategies.
- Task boundaries come from the messages Ork sends into a resumed session.
- Added the correction behind "touch" and the "edit" variant.
- Token sizes come from usage growth.
- The new session's start is priced from the session's own first turn, including
  the part of it that is shared across sessions.
- Cache misses in the original shrink along with cache reads.
- Re-reads cost extra turns.
- Added sweeps over R and over the handoff size.

## Results

Saving on builder cost ($149.44) with a 2k handoff. A negative number is a loss.

| Strategy   | Splits | zero          | edit          | **touch**          | touch-raw      | all              |
| ---------- | -----: | ------------- | ------------- | ------------------ | -------------- | ---------------- |
| once@20    |     37 | $6.88 (4.6%)  | $4.92 (3.3%)  | **−$0.45 (−0.3%)** | −$2.50 (−1.7%) | −$17.05 (−11%)   |
| once@40    |     27 | $10.27 (6.9%) | $8.36 (5.6%)  | **$3.14 (2.1%)**   | $2.22 (1.5%)   | −$16.22 (−11%)   |
| once@60    |     17 | $11.07 (7.4%) | $9.81 (6.6%)  | **$5.43 (3.6%)**   | $4.77 (3.2%)   | −$12.90 (−8.6%)  |
| every 40   |     51 | $21.61 (14%)  | $19.19 (13%)  | **$6.65 (4.4%)**   | $4.90 (3.3%)   | −$58.90 (−39%)   |
| every 60   |     28 | $19.08 (13%)  | $17.82 (12%)  | **$8.92 (6.0%)**   | $7.94 (5.3%)   | −$34.57 (−23%)   |
| tasks      |     38 | $17.44 (12%)  | $16.37 (11%)  | **$8.82 (5.9%)**   | $6.20 (4.2%)   | −$47.63 (−32%)   |
| tasks>100k |     24 | $18.13 (12%)  | $17.36 (12%)  | **$10.32 (6.9%)**  | $7.79 (5.2%)   | −$45.78 (−31%)   |
| any-prompt |     58 | $15.16 (10%)  | $13.88 (9.3%) | **$6.26 (4.2%)**   | $3.55 (2.4%)   | −$56.46 (−38%)   |
| ctx>150k   |     33 | $20.65 (14%)  | $19.54 (13%)  | **$1.24 (0.8%)**   | −$1.74 (−1.2%) | −$181.03 (−121%) |
| best-once  |      — | $18.67 (12%)  | $17.40 (12%)  | **$11.37 (7.6%)**  | $10.67 (7.1%)  | $0.97 (0.6%)     |

### How much the answer depends on R

- **Break-even:** each strategy saves money only while the new session re-reads
  less than a fraction f of every tool result made before the split. f is 0.30
  for once@20, 0.42 for once@40, 0.50 for once@60, 0.33 for every 40, 0.34 for
  tasks, 0.37 for tasks>100k and 0.29 for ctx>150k.
- **Scaling the touch allowance by ×0.5, ×1, ×1.5, ×2:**
  - tasks>100k saves 9.6%, 6.9%, 3.3%, −0.1%.
  - once@40 saves 4.5%, 2.1%, −0.4%, −2.9%.
- **Handoff size** (tasks>100k, touch): 7.8% with no handoff, 6.9% at 2k in and
  2k out, 5.8% at 5k/3k, 4.1% at 10k/5k.
- **Threshold for splitting at a task** (touch): 5.9% at no threshold, 6.0% at
  50k, 6.9% at 100k, 6.3% at 150k, 6.2% at 200k. Anything from 50k to 200k gives
  about the same.
- **Volume:** with the touch allowance, tasks>100k re-reads 0.56M tokens and
  removes 150M cache-read tokens, 32% of the builders' 464M. A mid-task split at
  150k re-reads 2.0M tokens: in the middle of a task, most of what was read is
  still needed.

### Where the saving is

With tasks>100k and the touch allowance, 13 of the 63 sessions are split. The
top 3 give $9.03 of the $10.32 net saving; 8 sessions save and 5 lose. By run:

| Run              | Saving on builder cost | Of the whole run            |
| ---------------- | ---------------------- | --------------------------- |
| follow-ups       | 20.1%                  | about 17% ($5.80 of $34.26) |
| cli-drivers-only | 6.5%                   |                             |
| codex-driver     | 5.8%                   |                             |
| for-each-run-1   | 5.3%                   |                             |
| onboard          | 2.6%                   |                             |

Small runs get nothing or lose a little.

The turn caps spread losses more widely. With every 40, 18 sessions lose and 9
save. A single-task session of 40 to 80 turns usually loses money from a split
at turn 20 or 40.

Across all 21 runs ($200.07), tasks>100k saves:

| Allowance | Saving on all runs |
| --------- | ------------------ |
| zero      | 9.1%               |
| edit      | 8.7%               |
| touch     | 5.2%               |
| touch-raw | 3.9%               |

## Verdict

**Not as a turn cap; as a narrow task rule, maybe.**

A fixed turn cap is not worth building:

- A split at turn 20 saves nothing once the new session re-reads what it uses.
- Splits at turn 40 or 60 save 2–4% of builder cost.
- Capping every k turns loses money in twice as many sessions as it helps.

The same goes for a context-size trigger in the middle of a task. Its result
depends almost entirely on how much the new session re-reads (0.8% at the middle
estimate).

The version that holds up is narrower: **start an owned builder's next delegated
task in a fresh session once its context is over about 100k tokens**, instead of
resuming the old session. That saves about 7% of builder cost (5–12% across the
allowance range), or about 5% of what the runs cost (4–9%). It needs no new
surface, only the decision between starting a session and resuming one.

The saving sits almost entirely in the few long owner sessions that take four to
seven tasks each; in the largest run it is about a fifth of builder cost.
Building it is worth it only as a cheap policy change measured before and after.
What it cannot be measured on is quality: a builder that starts fresh on its
fifth task loses what it learned on the first four. It is a smaller lever than
the extract tool RFC-023 chose, and a complement to it, not a rival.

## Caveats

- **A counterfactual model.** It keeps the later turns, outputs and new results
  unchanged. A fresh session might orient for longer, decide differently, or be
  sent back more often. Those costs are not modelled beyond the re-read turns
  and the handoff, and the quality effect is unknown.
- **R is a proxy.**
  - Matching paths is heuristic: a later call's input naming the file, and
    reading commands parsed from shell lines.
  - Token sizes from usage growth may include Claude Code's own injected text.
    That could overstate R, and the ×0.5 to ×2 sweep covers it.
  - What a session uses without naming it again is invisible to this method.
- **The new session's start** is priced as the session's own first turn. For a
  later task this counts a brief twice (once in that start, once as that turn's
  new content), which is slightly conservative.
- **Small and concentrated.** 63 builder sessions, and the result rests on about
  three of them. The runs are Ork building itself on the maintainer's workflows,
  with an owner-builder pattern that other workflows may not have.
- **Scope.** Only Claude Code sessions (including the older `cli` name of its
  driver) are counted. Subagent transcripts and forks are left out. Prices are
  the rates the benchmark tools use, not a new fit.

## A first attempt with runs

Before this estimate, a paid A/B on the two small tasks of the
[reading rule A/B](../rfc-025-reading/README.md) tried a "smaller tasks" plan
against the normal one. It could not separate the arms: on a change that small,
the leader built it itself in one arm and handed all four smaller tasks to a
single builder in the other, despite the plan. It was stopped after 2 runs and
part of a third, $2.38 in all, and nothing from it is counted here.

## Files

The script and its per-session output (actual and modelled cost of each builder
session, for each strategy and allowance) are kept with the maintainer's
benchmark data, not published: they name local session files. The script reuses
`tools/benchmark` (`loadTree`, `copyStore`, `transcriptsOf`, `priceOf`, `RATES`,
`kindOf`).
