# ADR-059 — Closing the feedback loop: built-in workflows, rule-based triage, previewed publishing

- **Status:** Accepted
- **Date:** 2026-11-06
- **Topic:** feedback / CLI / workflows
- **RFC:** waived — the maintainer chose among the options below directly, while
  planning the M2 feedback loop
- **Amends:** [ADR-013](./ADR-013-feedback-loop.md)

## Context

[ADR-013](./ADR-013-feedback-loop.md) has triage run as an Ork workflow
(`ork:feedback-triage`) that merges near-duplicates, summarizes each item and
proposes a fix; `ork feedback apply` run a node whose fix is a Decision; and a
publish shown as a Decision before it posts. Capture is built
([ADR-028](./ADR-028-feedback-capture.md)). Building the rest raised three
questions ADR-013 left open: how Ork ships a workflow of its own (it ships
built-in agents and skills, but no workflows), whether triage needs a model at
all, and how to confirm a publish when there is no run to hold a Decision.

## Decision

1. **Built-in workflows are workflow files, run by an `ork:` name.** Their
   sources are `packages/core/workflows/*.ork.yaml`, bundled into the core as
   text. `ork run ork:<name>` (and `validate`, `context explain`) writes the
   built-in into the project's gitignored run folder,
   `.ork/runs/.builtin/<hash of its text>/<name>.ork.yaml`, and runs that file.
   An unknown `ork:` name is refused, naming the built-ins. The first is
   `ork:feedback-apply`.
2. **Triage is deterministic.** `ork feedback triage` merges items with the same
   target and kind whose normalized titles share at least 80% of their words,
   after showing each merge and asking. No model runs. A summary and a proposed
   fix come from `ork feedback apply`, one item at a time, when the person asks.
   There is no `ork:feedback-triage`.
3. **`apply` never merges.** `ork:feedback-apply`'s worker commits a change on a
   branch in a worktree, under the project's rules, and a gate asks to keep or
   discard it. Keeping marks the item `resolved`; discarding removes the branch
   and leaves the item `accepted`.
4. **A publish is previewed, then confirmed** by the person: in the terminal
   (`y/N`, with no flag to skip it) or in the UI's Feedback panel, not as a
   run's Decision.
5. **Lessons stay under their cap.** Accepting a lesson that would take
   `.ork/lessons/<workflow>.md` past 1,500 tokens is refused; a file made longer
   by hand is cut at the cap when loaded, and `ork context explain` says so.

Details: [specs/feedback.md](../specs/feedback.md),
[running a workflow](../specs/cli/running-and-runs.md#running-a-workflow).

## Options considered

- **Built-ins as files, or built in code.** Code is less to ship, but nobody can
  read, copy or run the workflow by hand; files run like any other, and the
  Monitor, Logs and Decisions show them. Files chosen.
- **Where a built-in's file lives.** In `~/.ork` the run would belong to no
  project, as a run's project comes from its file's folder; in the project's run
  folder it belongs to the project, and resume reads the same file.
- **Triage by rules, by one workflow run (ADR-013), or rules with an optional
  model pass.** Rules chosen: grouping is mechanical, and a session per triage
  is the kind of cost Ork exists to cut. A model runs only for one item's fix.
- **Confirming a publish in the terminal or panel, or as a Decision in a small
  built-in run.** A run just to ask yes or no is heavier and no safer.
- **A lesson over the cap:** refused and cut on load, dropping the oldest, or a
  warning only. Refusing keeps the person in charge of what's cut.

## Rationale

Ork automates its own jobs with deterministic code and keeps model turns for
judgment; grouping feedback is not judgment, proposing a fix is. A built-in that
is an ordinary workflow file needs nothing new from the engine, and its runs
look like every other run. Anything that changes future runs or posts in public
still passes a person, as ADR-013 requires.

## Consequences

- `.ork/runs/.builtin/` holds one folder per version of a built-in's text; a run
  started before Ork changed a built-in resumes from the text it started with.
  Old folders are small and stay until the run folder is cleaned.
- Specs and the map no longer name `ork:feedback-triage`.
- A built-in's runs carry its own name (`ork-feedback-apply`), and its lessons
  file is `.ork/lessons/ork-feedback-apply.md`, so a project can teach it.
