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
node with `forEach` ([RFC-013](../rfcs/archived/RFC-013-for-each.md)) work in
worktrees as [below](#a-node-run-once-per-item); that is built. Why:
[ADR-020](../decisions/ADR-020-worktrees-beside-the-clone.md),
[ADR-018](../decisions/ADR-018-ork-merges-children.md),
[ADR-032](../decisions/ADR-032-project-rules.md).

This page describes Ork's default git rules. A project's
[rules](./project-rules.md) can rename branches and worktrees, start from
another base, never commit (detached worktrees, work handed over as patches), or
never merge.

A run of a workflow with `worktree` agent nodes gives each of them its own git
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

| Node                                     | Works in                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| an agent node with `isolation: worktree` | its own worktree (kept across loop rounds)                                    |
| `shared` or `readonly`                   | its nearest owner's worktree, or the project root                             |
| `readonly` with no owner                 | its input's worktree, or the root or [the base](#a-readonly-node-at-the-base) |
| `continue` (no owner, no children)       | the worktree its input came from, or its own                                  |
| tool and gate nodes                      | the same as `shared`, or the worktree of its `cwd`                            |

- **A readonly node with no owner follows its input**
  ([upstream.ts](../packages/core/src/worktree/upstream.ts),
  [ADR-029](../decisions/ADR-029-readonly-follows-its-input.md)): its incoming
  edges are followed back through control nodes and human gates
  ([ADR-036](../decisions/ADR-036-ork-migrate.md)) to the nodes that ran, and
  when they all worked in one worktree, it works there too. So a reviewer or
  approver after a leader sees the leader's branch. A node with `forEach` counts
  as where its items worked, and a tool node whose rendered `cwd` is inside one
  of the run's worktrees counts as working in that worktree (a resumed run
  renders a replayed tool node's `cwd` from the replayed outputs). Upstream
  nodes in different worktrees, or none, leave it in the project root, or in the
  [shared base worktree](#a-readonly-node-at-the-base) under
  `git.readonly: base`.

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
  the project's `HEAD` when the run starts (`git.base`). A remote `git.base`
  such as `origin/main` is fetched first (`git.fetch`,
  [fetching the base](./project-rules/fetch.md)).
- The session is told it is already in its own worktree on that branch, and must
  not create another worktree, switch branches, or push. Repositories whose own
  instructions tell agents to make a worktree first (such as a "one task, one
  worktree" rule) are satisfied by Ork's.
- `{{nodes.<id>.output.branch}}` is the node's Ork branch, and
  `{{nodes.<id>.output.worktree}}` its worktree's path.

## A readonly node at the base

With `git.readonly: base`
([rules](./project-rules/fetch.md#reading-at-the-base),
[readonly-base.ts](../packages/core/src/worktree/readonly-base.ts),
[tests](../packages/core/test/worktree-readonly-base.test.ts)), a `readonly`
node with no owner and no upstream worktree reads a worktree at the resolved
base commit, not the checkout, which may be on another branch or hold
uncommitted files.

- **One per run, shared.** Two such nodes use the same worktree, beside the
  clone under the reserved id `_readonly` (never a node's id). It is detached,
  has no branch, and gets no `.worktreeinclude` or other ignored local files, so
  a session sees only committed files.
- **Never written back.** It is not merged, committed or settled. A `continue`
  node after a readonly one gets a worktree of its own, not this one.
- **Recorded and removed.** `worktree` events `created` and `removed` record it,
  so `ork worktrees clean` finds one a crash left. It is removed, forced (an
  agent may have left a file), when the run finishes, fails or is stopped.
- **Not opened when it would not matter:** a readonly node with an owner or an
  upstream worktree works there; `--in-place` and a run with a
  [run root](./worktrees/run-root.md) open none, and `git.fetch: auto` is
  skipped there too. A resumed run uses the recorded base commit.
- **Id and upstream.** `_readonly` cannot be a node id (ids do not start with an
  underscore). Places in it are dropped before upstream resolution. A crashed
  run's `_readonly` worktree is adopted on resume.
- A workflow whose only isolated need is such a node still gets the repository
  check below, and a non-git project stops with the same message.

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

`ork run` checks the project when the workflow has `worktree` nodes, or, under
`git.readonly: base`, a `readonly` agent node:

- It must be a git repository with a commit, or the run does not start. Outside
  git the project root is the workflow file's folder, so the message strips a
  trailing `.ork/workflows` to name the project folder; it says "needs" for one
  isolated node and "need" for several.
- **Uncommitted instructions, skills or agents stop the run**: `CLAUDE.md` and
  `AGENTS.md` at any depth, `.claude/`, `.agents/`, and the targets of their
  `skills`, `agents`, `commands` and `rules` symlinks. Worktrees only get
  committed files, so the run would use other instructions than the user sees.
  `--allow-dirty` runs with the committed versions.
- Other uncommitted changes print a warning: they are not in the worktrees.
- A remote `git.base` is fetched before it is resolved, except on a resume or
  with a `baseRef`; a failed fetch stops the run
  ([fetching the base](./project-rules/fetch.md#fetching)).

## After a node

- Ork commits what the session left uncommitted, as `ork: <node> (run <id>)`,
  with no attribution. The repository's hooks run; if they refuse, the node
  fails with the hook's message and the worktree keeps the changes. While a
  rebase, merge, cherry-pick or revert is underway in the worktree (a conflict
  resolver's), Ork commits nothing and leaves it exactly as it is.
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
  merges the others; the item's output has `merge: { ok: false, … }`. A
  **failed** item's worktree is kept too, with the reason
  `item failed; kept for inspection`.
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
instead of creating them again. An adopted worktree is also where its node
worked, and a replayed node with no worktree of its own (a `readonly` reviewer,
a fanned item) worked where its last session ran (its `session.started` `cwd`),
when that is an adopted worktree. So a `readonly` or `continue` node after a
node the resume replays still follows its input there, rather than working in
the project root or a new worktree. A node that runs again after its worktree
was removed checks its `ork/<run>/<node>` branch out again and brings it up to
its owner's branch; new worktrees of root nodes branch from the project's
current `HEAD`.

## A run's own root

`ork:security-audit`, run in a project attached with `ork register`, works in a
worktree of the project's `HEAD` that holds its bundle, instead of the user's
checkout, so no repository file is written and read-only agents read the bundle
inside their own folder. Ork removes it when the run ends and re-creates it at
the recorded commit on a resume ([details](./worktrees/run-root.md),
[ADR-100](../decisions/ADR-100-audit-in-attached-projects.md)). So does
`ork:onboard-write` in such a project, with a seeded writer worktree
([below](#seeding-a-worktree)).

## Seeding a worktree

Status: **Built** ([seed.ts](../packages/core/src/worktree/seed.ts),
[patch.ts](../packages/core/src/worktree/patch.ts),
[ADR-114](../decisions/ADR-114-onboard-in-attached-projects.md)).
`createWorktree` and `openWorktree` take an optional
`seed: { from, to, paths }`: Ork copies the files `paths` names (exact paths
relative to `from`; `ork onboard` passes `workflows/*.ork.yaml` and
`project.yaml` of the attached folder) to `to` (relative to the worktree, `.ork`
or `app/.ork` for a subfolder project), then makes one commit, the **seed
commit**, and leaves the worktree detached.

- **Plain files only.** A link, or a path that would leave `from` or `to`, is
  skipped without a word; a bad `to` throws. Nothing is copied but the listed
  paths (no `runs/`, `skills/` or `context/`).
- **No hook.** The commit is made with plumbing (`git add -f`,
  `git commit-tree --no-gpg-sign`, `git update-ref`), so no commit hook runs,
  and `-f` takes a file the repository ignores. The `reference-transaction` hook
  may still run on `update-ref` ([L544](./gaps/onboard-limits.md)). The author
  is the repository's identity, else `Ork <ork@localhost>`. With nothing to seed
  there is no commit and `seed` is the unchanged `HEAD`.
- **Once, from the run's head.** A seed applies only to a worktree opened from
  the run's head (not to one that starts from an owner's), and never again when
  the worktree exists, so a resume does not seed over the work.
- **Recorded.** The `write` node's output carries `seed` (the commit), the
  `worktree` `created` event has an optional `seed`, and `run.started`'s
  `settings.seed` holds the folder, so `ork resume` seeds the same way
  ([events](./scheduler/resuming-and-events.md)).
- **`RunWorkflowOptions.seed`** (the CLI's) is the folder. It forces
  `commit: never` for the node worktrees and the run root (`merge: auto` becomes
  `patch`), so no `ork/<run>/…` branch is made.
- **A committed `.ork/` stays in the seed.** The worktree is cut from `HEAD`, so
  if the repository commits its own `.ork/`, files there that the attached
  folder lacks stay in the seed. Keep is still right: its patch is measured from
  the seed commit, not from `HEAD`.
- **`project-state.ts`** holds `inspectProject`, moved from `manager.ts` with no
  change in behavior.
- **The spike test** (`onboard-attached-spike.test.ts`) pins internal paths of
  the run root and worktrees; expect it to change when that layout does.
- **Applying back.** `changesSince(worktree, tree, relativeTo?)` takes the
  change as a patch whose paths are relative to `relativeTo` (a folder of the
  worktree, such as `app/.ork/`), and `applyChanges(into, patch)` applies it
  with `git apply --binary`, all or nothing, in `into`. By default git finds the
  repository `into` is in, so a patch with paths from the repository's top
  applies from a subfolder. With `{ plainFolder: true }` (only the seeded keep
  passes it) `into` need not be a repository: it sets `GIT_CEILING_DIRECTORIES`
  to the folder's parent so a folder inside another repository is applied to as
  it is, not relative to that repository's root (git would skip the files with
  no error). `git apply` refuses a path outside the folder and a write through a
  link.

## ork worktrees

`ork worktrees` (or `ork wt`) tracks and cleans what runs leave behind: the
branches and worktrees the project's runs recorded creating (`worktree`
`created` events, whatever the rules named them), and any `ork/` branch besides,
with their state read from git (`git worktree list --porcelain`). A recorded
item's worktree is the one at its recorded path, whatever branch it is on now;
another worktree with its branch checked out (the main checkout, or one of the
user's own, say `git worktree add ../review ork/r1/lead`) is not Ork's, and the
item has no worktree. An `ork/` branch no run recorded has the worktree that has
it checked out. It is listed (marked "not created by Ork") but never Ork's to
change: `clean` and `remove` keep it, even with `--force`, since Ork never
deletes a branch it did not create. Delete it with git.

- `ork worktrees [list] [--json]`: each branch (or, for a detached worktree, its
  run and node), its worktree path (or none, or missing), uncommitted changes,
  and how many commits are not merged into the current branch. A detached
  worktree is "merged" when its HEAD is an ancestor of the project checkout's
  HEAD (`git merge-base --is-ancestor`), so `clean` takes a clean one without
  `--all`; one with a commit the current branch lacks is not merged, so `clean`
  takes it only with `--all`, and with `--force` when it has changes or holds
  commits no branch, tag or remote has (a
  [`tool.git`](../decisions/ADR-034-tool-git.md) commit). A merged one with
  uncommitted changes is still kept ("uncommitted changes") unless `--force`. A
  worktree created detached that is now on a branch the workflow made
  (`switch -c`) shows that branch and counts its commits like an Ork branch's;
  `clean` never deletes that branch, so removing the worktree loses nothing.
- `ork worktrees clean`: by default only branches merged into the current
  branch; `--run <id>` limits it to one run; `--all` includes unmerged ones;
  `--branches` also deletes the branches. A worktree with uncommitted changes,
  an unmerged branch (with `--branches`), or a detached worktree holding
  unreachable commits is kept unless `--force`. A branch checked out in the main
  checkout or in a worktree Ork didn't create ("checked out in <path>"), and the
  worktree of a run still going ("its run is still going": its process is
  alive), and an `ork/` branch no run recorded ("not created by Ork"), are kept
  even with `--force`; stop the run first. It prints the plan and, with
  `--force`, what each item would lose (its `Loses in <item>:` block: the
  `remove` text below, for uncommitted changes and unmerged or unreachable
  commits), then asks; `--yes` skips the question, and without a terminal it is
  required. Declining prints `Cancelled.`. `--run <id>` names a run of the
  project: an unknown id is an error (exit 1) rather than an empty plan. A plan
  of only kept items prints those lines and no "Nothing to clean."; that line is
  for a plan with no items at all. A worktree whose folder is gone shows as
  `prune worktree` in the plan and `pruned <path>` once done; it is dropped by
  its own path (`git worktree remove`), never by `git worktree prune`, so a
  missing worktree that isn't Ork's keeps its entry. `clean` takes no name:
  given one, it prints that to stderr, points to `ork worktrees remove <name>`,
  exits 1 and plans nothing (before it opens the store or asks).
- `ork worktrees remove <branch|run/node|path> [--branch] [--force] [--yes]`:
  one item, by its branch or (detached) the `run/node` name `list` shows or its
  worktree's path (a symlinked path is resolved first), by the same rule as
  clean. It removes the worktree; `--branch` also deletes the branch, and a
  recorded branch with no worktree is deleted. An `ork/` branch no run recorded
  is refused with a message, not deleted. When that loses work (uncommitted
  changes, an unmerged branch's commits, a detached worktree's unreachable
  commits) it prints what's lost, as `git status --porcelain` and
  `git log --oneline` print it, and needs `--force`. It asks first, as clean
  does. It changes only its own item: a worktree whose folder is gone is dropped
  by its own path (`git worktree remove`), never by a prune of every missing
  one.

In a repository with no commit yet, `ork worktrees` prints an empty list and
exits 0 (nothing can have been created); `clean` and `remove` still need a
commit.

The plain words (an item's name, its merge state, its state's parts, a plan's
line, why an item can't be removed) are core's
([words.ts](../packages/core/src/worktree/words.ts)), so the CLI and the panel
say the same thing; the CLI colors them.

The [Worktrees panel](./ui/panels-worktrees.md) shows the same list for every
project Ork knows, with **Remove…** (the twin of `ork worktrees remove`) and
**Clean merged…** (the twin of `ork worktrees clean`, never forced), through the
[worktrees routes](./server/api.md).

## Contents

- [A run's own root](./worktrees/run-root.md)
- [Limits: the Worktrees panel](./worktrees/limits.md)
