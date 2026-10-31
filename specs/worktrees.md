# Worktrees: where nodes work

Status: **Built** ([manager.ts](../packages/core/src/worktree/manager.ts),
[workspace.ts](../packages/core/src/worktree/workspace.ts),
[list.ts](../packages/core/src/worktree/list.ts),
[`ork worktrees`](../packages/cli/src/commands/projects.ts),
[tests](../packages/core/test/worktree.test.ts)). Why:
[ADR-020](../decisions/ADR-020-worktrees-beside-the-clone.md),
[ADR-018](../decisions/ADR-018-ork-merges-children.md),
[ADR-032](../decisions/ADR-032-project-rules.md).

This page describes Ork's default git rules. A project's
[rules](./project-rules.md) can rename branches and worktrees, start from
another base, never commit (detached worktrees, work handed over as patches), or
never merge.

A run of a workflow with `worktree` Claude nodes gives each of them its own git
worktree and branch; `ork run --in-place` runs everything in the project
checkout instead.

## Where each node works

| Node                                     | Works in                                          |
| ---------------------------------------- | ------------------------------------------------- |
| a Claude node with `isolation: worktree` | its own worktree (kept across loop rounds)        |
| `shared` or `readonly`                   | its nearest owner's worktree, or the project root |
| `readonly` with no owner                 | the worktree its input came from, or the root     |
| tool and gate nodes                      | the same as `shared`                              |

- **A readonly node with no owner follows its input**
  ([upstream.ts](../packages/core/src/worktree/upstream.ts),
  [ADR-029](../decisions/ADR-029-readonly-follows-its-input.md)): its incoming
  edges are followed back through control nodes and human gates
  ([ADR-036](../decisions/ADR-036-ork-migrate.md)) to the nodes that ran, and
  when they all worked in one worktree, it works there too. So a reviewer or
  approver after a leader sees the leader's branch. Upstream nodes in different
  worktrees, or none, leave it in the project root.

- A worktree lives **beside the clone**:
  `../<clone>-worktrees/ork-<run>-<node>`, on branch `ork/<run>/<node>`
  (`git.worktrees` and `git.branch`). Claude Code loads `CLAUDE.md` and
  `CLAUDE.local.md` from the working directory and every parent, so a worktree
  inside the clone would load the main checkout's instructions on top of the
  branch's; beside the clone, each session loads one set, from its own branch.
- It branches from its nearest owner's branch, or, for a node without one, from
  the project's `HEAD` when the run starts (`git.base`).
- The session is told it is already in its own worktree on that branch, and must
  not create another worktree, switch branches, or push. Repositories whose own
  instructions tell agents to make a worktree first (such as a "one task, one
  worktree" rule) are satisfied by Ork's.
- `{{nodes.<id>.output.branch}}` is the node's Ork branch, and
  `{{nodes.<id>.output.worktree}}` its worktree's path.

## What a worktree gets

- The committed tree at its base: tracked instructions and skills, including
  symlinked ones (`.claude/skills -> ../.ai/skills`).
- Every gitignored `CLAUDE.local.md` and `.claude/settings.local.json`, so a
  session sees the same local layer an in-place run would.
- The gitignored files the repository's `.worktreeinclude` lists (gitignore
  syntax; Claude Code's convention), for example `.env`. Only files that are
  also gitignored are copied.
- The reported `artifacts` of nodes that finished in another checkout, when they
  are missing there (e.g. a `shared` `spec` node writes `spec.md` in the project
  root; the builder's worktree gets it, and it is committed on the builder's
  branch).

## Before the run

`ork run` checks the project when the workflow has `worktree` nodes:

- It must be a git repository with a commit, or the run does not start.
- **Uncommitted instructions, skills or agents stop the run**: `CLAUDE.md` and
  `AGENTS.md` at any depth, `.claude/`, `.agents/`, and the targets of their
  `skills`, `agents`, `commands` and `rules` symlinks. Worktrees only get
  committed files, so the run would use other instructions than the user sees.
  `--allow-dirty` runs with the committed versions.
- Other uncommitted changes print a warning: they are not in the worktrees.

## After a node

- Ork commits what the session left uncommitted, as `ork: <node> (run <id>)`,
  with no attribution. The repository's hooks run; if they refuse, the node
  fails with the hook's message and the worktree keeps the changes.
- A child that passes is merged into its owner's worktree with `--no-ff`, one
  merge per owner at a time. A conflict aborts the merge; the child's output
  gets `merge: { ok: false, conflicts, into }` and its worktree is kept. A child
  whose owner has no worktree is not merged.

## Delegation

When a leader delegates ([scheduler](./scheduler.md#delegation)):

- Ork first commits the leader's uncommitted work, as
  `ork: <leader> before delegating (run <id>)`, so its children branch from it.
  If the hooks refuse, the children start from the leader's last commit and the
  leader is told why.
- Each child works in its own worktree on `ork/<run>/<child>`, branched from the
  leader's branch; a spawned worker `<template>-<n>` gets
  `ork/<run>/<template>-<n>`. A passing child is merged into the leader's
  worktree before `delegate` returns, so the leader sees the result in its
  checkout.
- A child that runs again (another delegation, or a loop) starts from its
  owner's branch: its worktree is fast-forwarded when it has nothing unmerged. A
  run counts as merged only once its own work is merged.

## After the run

- A merged child's worktree is removed (its branch stays).
- Root nodes' worktrees (the run's result) and unmerged ones stay; the run
  summary lists each with its branch, path and reason.
- Ork never pushes, and never takes over, moves or deletes a branch its runs did
  not create.

## Resuming a run

`ork resume` ([scheduler](./scheduler.md#resuming-a-run)) adopts the worktrees
the run left whose folders are still there, merged or not, instead of creating
them again. A node that runs again after its worktree was removed checks its
`ork/<run>/<node>` branch out again and brings it up to its owner's branch; new
worktrees of root nodes branch from the project's current `HEAD`.

## ork worktrees

`ork worktrees` (or `ork wt`) tracks and cleans what runs leave behind: the
branches and worktrees the project's runs recorded creating (`worktree`
`created` events, whatever the rules named them), and any `ork/` branch besides,
with their state read from git (`git worktree list --porcelain`):

- `ork worktrees [list] [--json]`: each branch (or, for a detached worktree, its
  run and node), its worktree path (or none, or missing), uncommitted changes,
  and how many commits are not merged into the current branch. A detached
  worktree is never "merged", so `clean` takes it only with `--all`, and with
  `--force` when it has changes or holds commits no branch, tag or remote has (a
  [`tool.git`](../decisions/ADR-034-tool-git.md) commit).
- `ork worktrees clean`: by default only branches merged into the current
  branch; `--run <id>` limits it to one run; `--all` includes unmerged ones;
  `--branches` also deletes the branches. A worktree with uncommitted changes,
  an unmerged branch (with `--branches`), or a branch checked out in the main
  checkout is kept unless `--force`. It prints the plan and asks first; `--yes`
  skips the question, and without a terminal it is required. Stale entries are
  pruned.

The UI (M2) shows the same list as a panel.
