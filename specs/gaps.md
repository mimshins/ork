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
  background. ([cli](./cli/running-and-runs.md#resuming-a-run))
- **G4 · No built-in `ork:*` skills.** The layer is resolved, but
  `BUILTIN_SKILLS` is empty.
  ([ADR-023](../decisions/ADR-023-context-compiler.md),
  [skills.ts](../packages/core/src/context/skills.ts))
- **G5 · Human notes have no milestone.** Rating or annotating a result is part
  of feedback capture's design but not of any roadmap item.
  ([feedback](./feedback.md))
- **G6 · A dismissed feedback item cannot be brought back.** `ork feedback` has
  no way to set an item's status other than `dismiss`; triage (M2) sets the
  rest. ([feedback](./feedback.md))
- **G7 · No built-in agents.** The catalog has a place for agents that ship with
  Ork, like the built-in skills (G4); there are none yet.
  ([catalog.ts](../packages/core/src/agents/catalog.ts))

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
- **L10 · Claims are advisory.** They steer agents but lock nothing: a node that
  edits without claiming is not stopped.
  ([ADR-027](../decisions/ADR-027-advisory-claims.md))
- **L11 · Readonly nodes run no commands.** `readonly` denies Bash, so a
  reviewer reads the code but cannot run `git diff` or the tests.
  ([context](./context.md))
- **L12 · Only `model` is read from another tool's agent frontmatter.** Claude
  Code's `tools` list and OpenCode's settings in an agent's markdown are left to
  those tools; Ork's own settings go in `<name>.agent.yaml`
  ([ADR-030](../decisions/ADR-030-agents-fill-nodes.md)).
- **L13 · Tool folders are linked with symlinks.** On native Windows, git checks
  links out as plain files unless `core.symlinks` is on (developer mode); there
  is no junction or copy fallback.
  ([ADR-031](../decisions/ADR-031-ork-is-the-origin.md))
- **L14 · Project permissions are `allow` and `deny` only.** Claude Code's `ask`
  list (prompt before a tool) is left to the project's own
  `.claude/settings.json`, which a node loads.
  ([project rules](./project-rules.md))
- **L15 · A patch applies whole or not at all.** Under `merge: patch`, a child
  whose changes do not apply cleanly is kept with the conflicting files named;
  there is no three-way apply with conflict markers.
  ([ADR-032](../decisions/ADR-032-project-rules.md))
- **L16 · `git.base` is not fetched.** A base such as `origin/main` is whatever
  the clone last fetched; Ork never fetches.
  ([project rules](./project-rules.md))
- **L17 · A `tool.git` commit under `commit: never` is on no branch.** The
  worktree is detached, so the workflow makes its own branch (`switch -c`,
  allowed on the node) or the commit stays on none; `ork worktrees clean` keeps
  such a worktree unless `--force`. Ork could make the root's branch from
  `git.branch` without committing. ([ADR-034](../decisions/ADR-034-tool-git.md))
- **L18 · An allow list checks the subcommand, not its flags.**
  `allow: [commit]` also allows `commit --amend` or `commit --no-verify`; what
  follows the prefix is the workflow's.
  ([workflow format](./workflow-format.md))

- **L19 · An attached project's own folder holds only agents and lessons.** A
  skill or context file kept in `~/.ork/projects/<id>/` cannot be referenced: an
  attached workflow's paths resolve inside the repository.
  ([projects](./projects.md))
- **L20 · A project is found by its root path.** Moving or renaming a registered
  clone leaves its record behind (`ork projects` marks it missing); forget it
  and register it again. ([projects](./projects.md))
- **L21 · A drafted workflow's agents each work in their own worktree.**
  `ork migrate --from-agents` chains workers; an earlier agent's files reach the
  last one only as reported artifacts, and only the last one's worktree is
  staged and committed. Sharing one worktree between siblings is not built.
  ([ADR-036](../decisions/ADR-036-ork-migrate.md))
- **L22 · A migration is not atomic.** Its plan is checked before anything
  moves, but a move that fails halfway (a permission, a full disk) stops there;
  nothing is lost, and `ork migrate` again plans what is left.
  ([projects](./projects.md#migrating))

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
- **C5 · The examples have not run on the SDK driver.** Both ran end to end on
  the CLI driver (2026-10-31); the SDK pass needs `ANTHROPIC_API_KEY` on the
  machine that runs it. ([examples](../docs/guides/examples.md))
