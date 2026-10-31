# Worktrees and isolation

Agents that write code each get their own **git worktree**: a second checkout of
your repository, on its own branch. Parallel agents never edit the same files,
your own checkout is never touched, and every result is a branch you can review,
merge or throw away. The contract is the
[worktrees spec](../../specs/worktrees.md).

This page describes Ork's defaults. Your project can rename the branches and
worktrees, start from another base, or never commit at all (detached worktrees,
changes handed over uncommitted): see [project rules](./project-rules.md).

## Choosing a node's isolation

| `isolation`          | Where the node works                                                  |
| -------------------- | --------------------------------------------------------------------- |
| `worktree` (default) | its own worktree, on branch `ork/<run>/<node>`                        |
| `shared`             | its owner's worktree, or your project's checkout when it has no owner |
| `readonly`           | like `shared`, but the tools that write files are denied              |

Tool and gate nodes work like `shared`. Set a default for the workflow with
`defaults.isolation`, and override it per node.

Good fits:

- `worktree` for anything that writes code.
- `readonly` for reviewers: they see the work in their owner's checkout and
  cannot change it. A readonly node with no owner works in the worktree its
  input came from (through joins, routers and gates), so an approver after a
  leader reads the leader's branch.
- `shared` for a step whose output you want in your checkout, such as a spec
  written to `spec.md`.

## Where the worktrees go

Beside your clone, not inside it:

```
~/code/my-app/                          your checkout
~/code/my-app-worktrees/
  ork-<run>-builder/                    on ork/<run>/builder
  ork-<run>-tests/                      on ork/<run>/tests
```

Claude Code reads `CLAUDE.md` from the working directory and every folder above
it. A worktree inside your clone would load your checkout's instructions on top
of its own branch's; beside the clone, each session sees one set.

A node branches from its owner's branch, or from your `HEAD` when the run
started. The session is told it already has a worktree, so it will not make
another, switch branches, or push.

## What a worktree contains

- Everything committed at its base, including your instructions and skills.
- Your local, gitignored `CLAUDE.local.md` and `.claude/settings.local.json`.
- Gitignored files listed in `.worktreeinclude` (gitignore syntax, the same file
  Claude Code uses), for example `.env`.
- Files another node reported as artifacts from a different checkout, such as a
  `spec.md` written by a `shared` node.

## Commit your instructions first

Worktrees only see committed files. So when a workflow has `worktree` nodes,
`ork run` stops if `CLAUDE.md`, `AGENTS.md`, `.claude/` or `.agents/` have
uncommitted changes: the agents would follow different instructions than the
ones you see. Commit them, or pass `--allow-dirty` to run with the committed
versions. Other uncommitted changes only print a warning.

The project must be a git repository with at least one commit.

## After each node

- Ork commits what the session left uncommitted, as `ork: <node> (run <id>)`.
  Your repository's git hooks run; if they refuse, the node fails with the
  hook's message and keeps its changes.
- A child that passes is merged into its owner's worktree. A conflict is
  aborted, reported to the owner, and the child's worktree is kept.

## After the run

- Worktrees of merged children are removed; their branches stay.
- The root nodes' worktrees (the run's result) and anything unmerged stay. The
  run summary lists each one with its branch, path and reason.
- Ork never pushes, and never takes over, moves or deletes a branch it did not
  create.

## Cleaning up

```sh
ork worktrees                     # or `ork wt`: what runs created, and its state
ork worktrees clean               # merged branches' worktrees; asks first
ork worktrees clean --run <id>    # one run only
ork worktrees clean --all         # unmerged ones too
ork worktrees clean --branches    # delete the branches as well
```

The list shows each branch's worktree path, uncommitted changes, and commits not
yet merged into your current branch. Cleaning keeps anything with uncommitted
changes, or a branch you have checked out, unless you add `--force`. Without a
terminal, `--yes` is required. It lists what your runs recorded creating,
whatever your rules named it, plus any `ork/` branch, and reads their state from
git, so it works for any run, even one from a crashed process. A detached
worktree (`commit: never`) is cleaned only with `--all`, and one holding a
commit no branch has (a `tool.git` commit) only with `--force` too.

## Running without worktrees

`ork run <wf> --in-place` runs every node in your checkout instead. It is handy
for a quick try, but parallel writers share the same files; they claim what they
edit ([claims](./leaders-and-delegation.md#claims-parallel-writers-stay-apart)),
which keeps them apart only as far as they follow it.
