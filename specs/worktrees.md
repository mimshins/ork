# Worktrees: where nodes work

Status: **Built** ([manager.ts](../packages/core/src/worktree/manager.ts),
[workspace.ts](../packages/core/src/worktree/workspace.ts),
[list.ts](../packages/core/src/worktree/list.ts),
[clean.ts](../packages/core/src/worktree/clean.ts),
[remove.ts](../packages/core/src/worktree/remove.ts),
[words.ts](../packages/core/src/worktree/words.ts),
[`ork worktrees`](../packages/cli/src/commands/worktrees.ts), the
[Worktrees panel](./ui/panels-worktrees.md),
[tests](../packages/core/test/worktree.test.ts),
[remove tests](../packages/core/test/worktree-remove.test.ts),
[git variable tests](../packages/core/test/git-env.test.ts),
[for-each tests](../packages/core/test/worktree-for-each.test.ts)). Items of a
node with `forEach` ([RFC-013](../rfcs/active/RFC-013-for-each.md)) work in
worktrees as [below](#a-node-run-once-per-item); that is built. Why:
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

**Git's local variables are cleared.** Ork finds a project by its path, never
through `GIT_DIR`. So `ork` drops every variable
`git rev-parse --local-env-vars` names (`GIT_DIR`, `GIT_WORK_TREE`,
`GIT_INDEX_FILE`, … in [git-env.ts](../packages/core/src/worktree/git-env.ts))
at its entry, and core's git runner leaves them out too: run from a git hook,
Ork, its sessions, tool nodes and detached runs act on their own repositories,
not the hook's. An outer `git -c key=value` (`GIT_CONFIG_PARAMETERS`) no longer
reaches Ork's git either.

## Where each node works

| Node                                     | Works in                                          |
| ---------------------------------------- | ------------------------------------------------- |
| a Claude node with `isolation: worktree` | its own worktree (kept across loop rounds)        |
| `shared` or `readonly`                   | its nearest owner's worktree, or the project root |
| `readonly` with no owner                 | the worktree its input came from, or the root     |
| `continue` (no owner, no children)       | the worktree its input came from, or its own      |
| tool and gate nodes                      | the same as `shared`                              |

- **A readonly node with no owner follows its input**
  ([upstream.ts](../packages/core/src/worktree/upstream.ts),
  [ADR-029](../decisions/ADR-029-readonly-follows-its-input.md)): its incoming
  edges are followed back through control nodes and human gates
  ([ADR-036](../decisions/ADR-036-ork-migrate.md)) to the nodes that ran, and
  when they all worked in one worktree, it works there too. So a reviewer or
  approver after a leader sees the leader's branch. Upstream nodes in different
  worktrees, or none, leave it in the project root.

- **A `continue` node writes where its input was**
  ([ADR-037](../decisions/ADR-037-isolation-continue.md)): found as for a
  readonly node, it works in that worktree with its write tools, and Ork commits
  its leftovers there (unless `commit: never`); its output's `worktree` and
  `branch` are that worktree's. With no one worktree upstream it gets its own.

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
  run counts as merged only once its own work is merged. A worktree removed
  outside Ork in between is opened again, from its owner's work.

## A node run once per item

Each item of a node with `forEach` ([scheduler](./scheduler/for-each.md)) is a
node of its own here, with its id `<node>.<n>` as `{node}`: the default is the
branch `ork/<run>/build.2` and the folder `ork-<run>-build.2`, and a custom
`git.branch` or `git.worktrees` is rendered the same way. Items follow the rules
a node of that declared kind does:

- A fanned **root** node's passing items keep their branches and worktrees, as
  the run's result. Combining them is a later node's job.
- A fanned node with a **`parent`** has each passing item merged (or patched)
  into the owner's worktree, one item at a time however many ran together, and
  the item's worktree is then removed. A conflict keeps that item's worktree and
  merges the others; the item's output has `merge: { ok: false, … }`.
- Under **`commit: never`** there are no item branches: each item has a detached
  worktree, its `results` entry has `worktree` and no `branch`, and with a
  `parent` the default `merge: patch` applies each passing item to the owner,
  uncommitted, one at a time (`merge: never` keeps every item's worktree).
- A resumed run adopts the item worktrees whose folders are still there.
- `ork worktrees` lists items under their ids, and
  `ork worktrees remove <run>/build.2` removes one by its listed name, as for a
  detached worktree.

## After the run

- A merged child's worktree is removed (its branch stays).
- Root nodes' worktrees (the run's result) and unmerged ones stay; the run
  summary lists each with its branch, path and reason.
- Ork never pushes, and never takes over, moves or deletes a branch its runs did
  not create.

## Resuming a run

`ork resume` ([scheduler](./scheduler/resuming-and-events.md#resuming-a-run))
adopts the worktrees the run left whose folders are still there, merged or not,
instead of creating them again. A node that runs again after its worktree was
removed checks its `ork/<run>/<node>` branch out again and brings it up to its
owner's branch; new worktrees of root nodes branch from the project's current
`HEAD`.

## ork worktrees

`ork worktrees` (or `ork wt`) tracks and cleans what runs leave behind: the
branches and worktrees the project's runs recorded creating (`worktree`
`created` events, whatever the rules named them), and any `ork/` branch besides,
with their state read from git (`git worktree list --porcelain`). A recorded
item's worktree is the one at its recorded path, whatever branch it is on now;
another worktree with its branch checked out (the main checkout, or one of the
user's own, say `git worktree add ../review ork/r1/lead`) is not Ork's, and the
item has no worktree. An `ork/` branch no run recorded has the worktree that has
it checked out.

- `ork worktrees [list] [--json]`: each branch (or, for a detached worktree, its
  run and node), its worktree path (or none, or missing), uncommitted changes,
  and how many commits are not merged into the current branch. A detached
  worktree is never "merged", so `clean` takes it only with `--all`, and with
  `--force` when it has changes or holds commits no branch, tag or remote has (a
  [`tool.git`](../decisions/ADR-034-tool-git.md) commit). A worktree created
  detached that is now on a branch the workflow made (`switch -c`) shows that
  branch and counts its commits like an Ork branch's; `clean` never deletes that
  branch, so removing the worktree loses nothing.
- `ork worktrees clean`: by default only branches merged into the current
  branch; `--run <id>` limits it to one run; `--all` includes unmerged ones;
  `--branches` also deletes the branches. A worktree with uncommitted changes,
  an unmerged branch (with `--branches`), or a detached worktree holding
  unreachable commits is kept unless `--force`. A branch checked out in the main
  checkout or in a worktree Ork didn't create ("checked out in <path>"), and the
  worktree of a run still going ("its run is still going": its process is
  alive), are kept even with `--force`; stop the run first. It prints the plan
  and asks first; `--yes` skips the question, and without a terminal it is
  required. A worktree whose folder is gone shows as `prune worktree` in the
  plan and `pruned <path>` once done; it is dropped by its own path
  (`git worktree remove`), never by `git worktree prune`, so a missing worktree
  that isn't Ork's keeps its entry. `clean` takes no name: given one, it prints
  that to stderr, points to `ork worktrees remove <name>`, exits 1 and plans
  nothing (before it opens the store or asks).
- `ork worktrees remove <branch|run/node|path> [--branch] [--force] [--yes]`:
  one item, by its branch or (detached) the `run/node` name `list` shows or its
  worktree's path, by the same rule as clean. It removes the worktree;
  `--branch` also deletes the branch, and a branch with no worktree is deleted.
  When that loses work (uncommitted changes, an unmerged branch's commits, a
  detached worktree's unreachable commits) it prints what's lost, as
  `git status --porcelain` and `git log --oneline` print it, and needs
  `--force`. It asks first, as clean does. It changes only its own item: a
  worktree whose folder is gone is dropped by its own path
  (`git worktree remove`), never by a prune of every missing one.

The plain words (an item's name, its merge state, its state's parts, a plan's
line, why an item can't be removed) are core's
([words.ts](../packages/core/src/worktree/words.ts)), so the CLI and the panel
say the same thing; the CLI colors them.

The [Worktrees panel](./ui/panels-worktrees.md) shows the same list for every
project Ork knows, with **Remove…** (the twin of `ork worktrees remove`) and
**Clean merged…** (the twin of `ork worktrees clean`, never forced), through the
[worktrees routes](./server/api.md).

## Contents

- [Limits: the Worktrees panel](./worktrees/limits.md)
