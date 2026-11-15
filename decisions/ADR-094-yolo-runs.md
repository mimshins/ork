# ADR-094 — Yolo runs: a run that asks no permission, agreed to per start

- **Status:** Accepted
- **Date:** 2026-11-15
- **Topic:** CLI, core, runtime, permissions
- **RFC:** waived — the maintainer decided this directly on 2026-11-15

## Context

On `claude-code` every tool call a node's `allow` list doesn't cover becomes a
permission prompt in `ork decide`; on `open-code` and `command-code` it is
refused, as they can't ask mid-session. A long run stops on prompts again and
again: the QA pass of 2026-11-15 asked nine times in fifteen minutes. The
maintainer wanted a way to run with no prompts, at their own risk, with a
warning and a confirmation.

## Options considered

- **Where it is switched on:** per run (`ork run --yolo`, chosen); a project
  setting (`permissions.mode: yolo`), easy to forget it is on; or both.
- **What it skips:** tool permissions only (chosen); also deny lists; also
  gates.
- **How it is done:** each driver's own bypass
  (`claude --permission-mode bypassPermissions`,
  `cmd --dangerously-skip-permissions` alone), or Ork answering (chosen): with a
  bypass Ork neither sees nor records what was allowed, and whether a deny list
  holds depends on each tool.

## Decision

- **`--yolo` on `ork run` and `ork resume`.** Ork prints a warning and asks
  `Run with no permission prompts?`, No by default. `--yes` (`-y`) agrees
  without it; with no terminal only `--yes` agrees. A detached start asks before
  it detaches and passes `--yes` to its copy.
- **Ork answers the prompt itself.** The run's decision queue records each
  permission prompt as a decision answered `allow` by `yolo`, at once, so the
  log and `ork ui` show what ran. `open-code` and `command-code` write rules
  that allow what the node's `deny` (and `only`) don't refuse.
- **Only permissions.** Deny lists, `only`, Ork's `.env` refusal, questions,
  gates, budgets and turn caps are unchanged.
- **Recorded per start.** `run.started.settings.yolo`; a resume is yolo only
  with `--yolo` again, and a run a yolo run calls inherits it (`--yolo --yes`).
- **Seen while live.** `ork ps` (and `"yolo": true` in `--json`), `ork tree`,
  the run's first line (`· yolo`) and the Runs panel of `ork ui`.
- **Only a person starts one.** `ork ui`, `ork mcp`'s `start_run` and triggers
  take no `--yolo`.

## Consequences

- A user who always types `--yolo -y` sees the warning but is never asked; it
  stays per run and visible.
- `answered_by` gains the value `yolo`; the store's tables don't change, and an
  older Ork reading the store sees such a decision as answered by no one named.
- Credentials are untouched: Ork still stores none, and a skipped prompt's
  record is masked like every decision.

## References

- [Running and runs](../specs/cli/running-and-runs.md#running-a-workflow)
- [With no permission prompts](../docs/guides/running-workflows/running-and-answering.md#with-no-permission-prompts---yolo)
