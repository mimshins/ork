# Known gaps and limits

Status: **Open**: every entry waits for the review at the end of the roadmap
([roadmap](../docs/interaction-map/public/js/data/roadmap.js), item
`gaps-review`).

What Ork leaves out or does a simpler way for now, in one place, so none of it
is forgotten. Specs, ADRs and guides still describe each where it applies; this
register is the list to decide from.

- A **gap** is something specified or expected that is not built, and is not on
  the roadmap.
- A **limit** is how something built works for now, by choice.
- A **chore** is upkeep on the repository rather than on Ork.

Add an entry in the change that finds it, and remove it in the change that
closes it. At the review, each open entry is closed (built or fixed, then
removed), kept (recorded as permanent where it applies, then removed), or
carried to the next milestone.

## Gaps

- **G1 · `claude.subagent` never runs.** The schema and the graph compiler
  accept it (owned by a leader or worker, no edges), but it is never passed to
  its parent's session as a Claude Code subagent (the SDK's `agents`, the CLI's
  `--agents`). ([concepts](./concepts.md),
  [plan.ts](../packages/core/src/run/plan.ts))
- **G2 · Messages do not outlive the run's memory.** The bus's inboxes are in
  memory; the events are the record. A message still unread when the run ends,
  or an `ork chat` message queued for a node that never starts again, is never
  delivered, and a resumed run starts with empty inboxes.
  ([ADR-025](../decisions/ADR-025-message-bus.md),
  [resume](./scheduler.md#resuming-a-run))
- **G3 · `ork resume` has no `--detach`.** Only `ork run` can run in the
  background. ([cli](./cli.md#resuming-a-run))
- **G4 · No built-in `ork:*` skills.** The layer is resolved, but
  `BUILTIN_SKILLS` is empty.
  ([ADR-023](../decisions/ADR-023-context-compiler.md),
  [skills.ts](../packages/core/src/context/skills.ts))
- **G5 · Human notes have no milestone.** Rating or annotating a result is part
  of feedback capture's design but not of any roadmap item.
  ([feedback](./feedback.md))

## Limits

- **L1 · A cut-off session starts over on resume.** A node cut off mid-session
  gets a new session; only a leader's re-entry resumes its previous round's
  session. ([ADR-026](../decisions/ADR-026-resume-by-replay.md))
- **L2 · A resumed run's budget counts what it spent.** Raise `limits.budgetUsd`
  to resume a run that ran out.
  ([ADR-026](../decisions/ADR-026-resume-by-replay.md))
- **L3 · Resume keeps finished results as they were.** The workflow file is read
  again, but a finished node keeps its result even if its definition changed,
  and new worktrees branch from the project's current `HEAD`.
  ([ADR-026](../decisions/ADR-026-resume-by-replay.md))
- **L4 · A run of one node is not resumed.** `ork run --node` runs again
  instead. ([ADR-026](../decisions/ADR-026-resume-by-replay.md))
- **L5 · A late notice is missed.** A message notice that lands while a session
  writes its final report is not seen; the message stays unread until the node
  runs again. ([ADR-025](../decisions/ADR-025-message-bus.md))
- **L6 · `delegate` blocks the leader.** There is no asynchronous form, and on
  the CLI driver one call can stay open for at most 24 hours.
  ([ADR-017](../decisions/ADR-017-blocking-delegate.md))
- **L7 · A shadowed project skill hides its alias.** Switching off a project
  skill named `review` also hides Claude Code's `/code-review`.
  ([ADR-023](../decisions/ADR-023-context-compiler.md))
- **L8 · Integrations ship with Ork.** A new CLI integration needs an Ork
  release; there are no declared or third-party integrations.
  ([ADR-022](../decisions/ADR-022-integration-registry.md))
- **L9 · Windows only through WSL.** Native Windows is untested.
  ([installation](../docs/getting-started/installation.md))

## Chores

- **C1 · CI runs on `ubuntu-latest`.** It is moving to Ubuntu 26; pinning
  `ubuntu-24.04` keeps CI from changing under us.
  ([ci.yml](../.github/workflows/ci.yml))
- **C2 · Release pull requests run no CI.** Pull requests opened with the
  built-in `GITHUB_TOKEN` trigger no workflows; the release workflow's full
  check still gates publishing. ([release](../runbook/development/release.md))
- **C3 · The interaction map is due a full resync.** Slices since its last sync
  were reviewed only where they touched the map, and its header badge still
  shows the old mark. ([sync](../docs/interaction-map/sync.md))
