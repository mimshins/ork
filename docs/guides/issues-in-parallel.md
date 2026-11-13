# Working on issues in parallel

Several GitHub issues at once: an agent builds each in its own worktree, a
reviewer checks each, and the ones that pass are integrated one at a time into
one branch, with one pull request that closes them. Ork's `issues` workflow does
this, and a **lock** is what lets many runs, or many agents, work toward one
branch without their pushes colliding.

You need the `gh` command signed in (`gh auth status`), Claude Code signed in
(the builders and reviewers run on `claude-code.sonnet`), a project with at
least one commit, and a git remote named `origin`. Ork reads no token: labels,
pull requests and pushes go through your own `gh` and git.

Details of how it works: [Integration](../../specs/integration.md).

## Contents

- [Taking and running the `issues` workflow](./issues-in-parallel/running-it.md)
  - [Take the workflow](./issues-in-parallel/running-it.md#take-the-workflow)
  - [Run it](./issues-in-parallel/running-it.md#run-it)
    - [If a run stops](./issues-in-parallel/running-it.md#if-a-run-stops)
    - [Adding to the same pull request](./issues-in-parallel/running-it.md#adding-to-the-same-pull-request)
- [Locks, conflicts and limits of `issues`](./issues-in-parallel/locks-and-conflicts.md)
  - [When two runs integrate at once](./issues-in-parallel/locks-and-conflicts.md#when-two-runs-integrate-at-once)
  - [A conflict](./issues-in-parallel/locks-and-conflicts.md#a-conflict)
  - [Many runs onto one branch, your own workflows](./issues-in-parallel/locks-and-conflicts.md#many-runs-onto-one-branch-your-own-workflows)
  - [A stale lock](./issues-in-parallel/locks-and-conflicts.md#a-stale-lock)
  - [Limits](./issues-in-parallel/locks-and-conflicts.md#limits)
