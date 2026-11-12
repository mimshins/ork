# Project rules

Ork does a few things on its own while a workflow runs: it commits each node's
work, merges a passing child into its owner, and names branches and worktrees.
Each of these is your project's choice. Write the rules once in
`.ork/project.yaml`, commit it, and every workflow in the project follows them.
A project [registered from outside](./projects.md) keeps them in
`~/.ork/projects/<id>/project.yaml` instead.

## The rules file

Every key is optional; leave one out and Ork does what it does by default.

```yaml
# .ork/project.yaml
schemaVersion: 1
git:
  commit: auto # or never
  merge: auto # or patch, or never
  base: HEAD # e.g. origin/main
  branch: "ork/{run}/{node}"
  worktrees: "../{clone}-worktrees/ork-{run}-{node}"
permissions:
  deny: ["Bash(git push *)"]
defaults:
  model: claude-code.sonnet
context: [docs/process.md]
```

- **`permissions`** are tool rules every agent node gets, added to its own
  `tools`.
- **`defaults`** apply to every workflow; a workflow's own `defaults` win.
- **`context`** files, from the project root, are read by every node, before the
  workflow's own.

For autocomplete, add this line at the top:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/mimshins/ork/main/packages/schema/project.schema.json
```

`ork validate` checks the file with every workflow and points at the line of a
mistake.

## Never committing

Some projects let no one commit until a human and a reviewer approve. With
`commit: never`, Ork runs no `git commit` at all:

```yaml
git:
  commit: never
```

- Each worktree is created **detached**: there is no branch to clean up.
- A node's work stays uncommitted in its worktree. Its output has `worktree`
  (the folder) instead of `branch`, so a later node or a gate can say
  `{{nodes.builder.output.worktree}}`.
- A child starts from its owner's work, committed or not, and a passing child's
  changes are applied to its owner's worktree, uncommitted (`merge: patch`, the
  default here). If they do not apply cleanly, nothing changes, the files are
  named, and the child's worktree is kept.
- Sessions are told not to commit.

The run's result is the root node's worktree with its changes uncommitted, for
you, or a commit step, to review and commit.

## Committing as a step

A `tool.git` node runs your own `git`, so the commit is a step your workflow
declares, after its gates:

```yaml
stage:
  type: tool.git
  command: add -A
  cwd: "{{nodes.builder.output.worktree}}"
approve:
  type: human.gate
  question: "Commit these changes?\n{{nodes.stage.output.staged}}"
  options: [commit, stop]
  recommended: commit
commit:
  type: tool.git
  command: commit -m "{{inputs.title}}"
  cwd: "{{nodes.builder.output.worktree}}"
```

- Without `allow`, a `tool.git` node may run `add` and `commit`. Anything else,
  `push` included, needs the node's own `allow` (`allow: [switch -c, commit]`).
- Its output has `staged` (the `git diff --cached --stat` summary), `diff` (the
  staged patch) and `head` (the commit after it ran), so the gate above shows
  exactly what will be committed.
- The commit uses your git identity, hooks and signing. `ork doctor` tells you
  whether `user.name` and `user.email` are set.
- Under `commit: never` the worktree has no branch. To commit on one, make it
  first: a `tool.git` node with
  `command: switch -c {{inputs.type}}/{{inputs.slug}}` and `allow: [switch -c]`.
  A commit on no branch is kept: `ork worktrees clean` leaves its worktree
  unless `--force`.

## Merging, or not

- **`merge: auto`**: a passing child's branch is merged into its owner's
  worktree (`--no-ff`). Needs commits.
- **`merge: patch`**: its changes are applied, uncommitted.
- **`merge: never`**: nothing is handed over; each child's worktree is kept.

## Your own branch and worktree names

```yaml
git:
  base: origin/main
  branch: "{inputs.type}/{inputs.slug}"
  worktrees: "../{clone}-worktrees/{inputs.type}-{inputs.slug}"
```

Templates take `{run}` (the run id), `{node}`, `{clone}` (your clone's folder
name) and `{inputs.<name>}`. Worktrees always go beside your clone, never inside
it. If a run can make more than one worktree, the names need `{node}`;
`ork validate` tells you. Without `{run}`, a second run stops while the first
one's branch exists: Ork never takes over a branch it did not create.

`base` must be a commit you have: Ork never fetches, so run `git fetch` first.

## A workflow's own rules

A workflow can override the project's under `rules:`:

```yaml
rules:
  git: { merge: never }
  permissions: { deny: ["Bash(rm *)"] }
```

Its `git` keys win; permissions add up.

## What a run asks of the machine

Two rules keep several runs from heating your machine
([running several runs at once](./running-workflows/several-runs.md)):

```yaml
heavy: [pnpm check, pnpm test, vitest run] # your full-suite commands
priority: low # low (the default) | normal
```

`heavy` names the commands that load the machine. Each takes one of 2 shared
slots (`ORK_HEAVY_SLOTS` changes the count), and a node with `verify:` may not
run them in its session, since Ork runs that check. `priority: low` starts
sessions and tool commands below your own programs; `normal` doesn't. A
workflow's `rules:` doesn't change either: they are the project's.

## Where follow-ups are kept

[Follow-ups](./follow-ups.md) are always listed in Ork's own store. Say where
each new one is also written out:

```yaml
followUps:
  store: store # store (the default), file or github
  file: .ork/follow-ups.md # for file, from the project root
  label: ork-follow-up # for github
```

- **`store`**: nowhere else.
- **`file`**: appended to the file, in the worktree the session works in, so it
  is **committed with the change** and public in a public repository.
- **`github`**: an issue through your own `gh`, labelled `ork-follow-up` (or
  your `label`); without a signed-in `gh` it stays in Ork's store, and says so.

## Trying an experiment

Features that aren't ready for everyone ship turned off. To try one, name it in
the project, for everyone working in it:

```yaml
experimental: [some-feature]
```

or in your environment, for you alone (several, separated by commas):

```sh
export ORK_EXPERIMENTAL=some-feature
```

`some-feature` stands for a real name: none has shipped yet. `ork doctor` lists
what is on and who turned it on. A name Ork doesn't know is a mistake, not a
no-op: `ork validate`, `ork run` and that `ork doctor` check fail, and say which
names exist.

## What never changes

Whatever the rules say, Ork never pushes on its own (a `tool.git` node pushes
only when its `allow` lists `push`), never takes over a branch it did not
create, and records every branch and worktree it makes.
[`ork worktrees`](./worktrees.md) lists and cleans exactly those, whatever they
are called.

For the full rules: [project rules](../../specs/project-rules.md).
