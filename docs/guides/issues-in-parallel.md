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

## Take the workflow

`ork init --issues` adds it to a new project as `.ork/workflows/issues.ork.yaml`
(on a terminal, `ork init` asks once; it never overwrites a file you changed).
In an existing project, run `ork init --issues` again, or download it like any
[example](./examples.md#issues).

## Run it

Label the issues you want worked (say `ready`), then name your project's check,
which runs in a fresh worktree after each integration:

```sh
ork run issues --input label=ready --input check="pnpm install --frozen-lockfile && pnpm run check"
```

Or name them: `--input issues=12,15,18`. A run takes at most 10, since each
costs a builder and a reviewer. A label with more than 10 open issues takes the
first 10. A list of more than 10 numbers is **refused** before anything is
labelled ("11 issues named; a run takes at most 10 …"): name 10 or fewer and run
again for the rest. A number named twice counts once. The branch they go into is
`ork/issues` unless you pass `--input branch=<name>`; the pull request goes to
`main` unless you pass `--input base=<name>`.

What happens:

1. Each issue gets the `in-progress` label, so you and your team see it is
   taken. By label, issues that already have it are skipped, so two runs over
   one label do not build the same issue. An issue you name by number is taken
   even if it has the label (to take one again after a run stopped, say).
2. A builder takes each issue in its own worktree (three at a time) and makes
   the change with its tests.
3. A reviewer reads each change. One that is not approved is left out.
4. The approved ones are integrated **one at a time** into the branch: each is
   rebased onto the branch as the one before left it, your check runs, and it is
   pushed as one commit, `Resolve #12: <title>`.
5. One pull request is opened (or updated) with `Closes #12`, `Closes #15`, … in
   its body. The labels come off.

An issue whose builder failed (or passed and left no branch), whose review asked
for changes, or whose integration could not finish is **left out**: it loses its
label, its work stays on its own branch, and the run's summary names it and why.
The rest still go in. The run's outputs are `integrated`, `leftOut` and `url`.

If the run fails before its pull request (no builder passes, no review passes,
no integration finishes, `gh pr create` fails, and so on), an `unmark` step
takes `in-progress` off every issue it listed and says so: "The run stopped
before its pull request; took in-progress off #12, #13." The run still ends
`failed`, and its first `✗` in the transcript is the cause.

### If a run stops

A run that is stopped (`ork stop`), times out, crashes or runs out of budget
fires no failure step, so its labels stay. List them and take them off:

```sh
gh issue list --label in-progress
gh issue edit 12 --remove-label in-progress
```

A label run skips issues that still have the label, so remove it first, or name
the issues by number.

### Adding to the same pull request

Run it again with the same `branch`. The new issues are rebased onto what is
already pushed, and the existing pull request's body gains their `Closes #n`
lines; the earlier ones stay.

## When two runs integrate at once

Say two `ork run issues --input branch=release-fixes …` are going, or an
`issues` run and a `build` that publishes. Only one pushes at a time. The other
**waits**, and says so:

```
waiting for branch:release-fixes, held by <run>/next
```

You see it in `ork ps`, `ork logs`, `ork tree` and the logs of `ork ui`. While a
run waits, no timeout of its node or of the run counts the wait. When the first
run lets go, the second takes over, rebases onto what the first pushed, and
pushes; neither push is rejected. Waiters go in the order they came. To stop
waiting, stop the run (`ork stop <run>`).

The lock is held by the whole machine, by remote and branch: another clone of
the same repository, or another project that pushes the same remote branch,
waits the same way.

A `branch:` lock is keyed by the origin of the repository that holds the
workflow file (for an attached project, the project's own repository), not by
the folder `ork run` was started from. A workflow file in no repository has no
origin, so its `branch:` lock is shared with no other run; `ork run` says so.

## A conflict

If an issue's change conflicts with what the branch already has, an agent
resolves it in the integration worktree. It edits only the conflicted files,
keeps what each side meant to do, and says what it kept. Then your check runs
again before the push. The lock is held the whole time.

You are asked **only when the resolution changes what a reviewed change does**:
the same logic was edited on both sides, and the agent chose, merged or rewrote
it. The question shows what each side did, what the agent kept, and the result,
and you answer `keep` (finish the rebase and check it) or `stop` (leave this
issue out, its branch kept). Two changes that only touch different parts of a
file go in without a question.

A wrong resolution can still pass your check, so read the pull request as you
would any other. If the check fails after a resolution, that issue is left out.

## Many runs onto one branch, your own workflows

You do not have to use `issues`. Any workflow can take the same lock on the
nodes that integrate:

```yaml
schemaVersion: 1
name: integrate
inputs:
  branch:
    type: string
    default: ork/issues
nodes:
  fetch:
    type: tool.shell
    script: git fetch origin "$BRANCH" && git rebase FETCH_HEAD
    env:
      BRANCH: "{{inputs.branch}}"
    lock: "branch:{{inputs.branch}}"
  check:
    type: tool.shell
    script: pnpm run check
    lock: "branch:{{inputs.branch}}"
  push:
    type: tool.shell
    script: git push origin "HEAD:refs/heads/$BRANCH"
    env:
      BRANCH: "{{inputs.branch}}"
    lock: "branch:{{inputs.branch}}"
edges:
  - fetch -> check
  - check -> push
```

The run takes the lock before the first node that names it and keeps it until
the last one ends (or the run does). So `fetch`, `check` and `push` happen with
no other run integrating the same branch in between. The edges order the three
nodes; without them all three are roots and run at once. Rules:

- One `lock:` name per node, and it may read only `{{inputs.*}}`.
- A name starting `branch:` is shared across clones of the same origin. Any
  other name (`lock: deploy-staging`) is shared by runs of the same project.
- A run keeps the lock while it waits for your answer to a question.
- If you stop a run, it lets go. A resumed run takes the lock again and runs the
  nodes that name it again from the first, since the branch may have moved.
- The conflict steps of the `issues` workflow come from
  [`resolve-conflict`](../../examples/resolve-conflict.ork.yaml), which you can
  copy into your workflow's nodes, or run alone in a checkout where a rebase has
  stopped.

## A stale lock

If an `ork` process is killed, its lock may be left. The next run that waits
takes it over when it sees the holder is gone, and `ork doctor` lists and clears
them too: it names each stale lock or check-slot record it removed.

A killed `ork` takes its nodes with it. On macOS and Linux each command and each
agent session runs beside a small watcher; when `ork` dies, even by `kill -9`,
the watcher ends what the node started within about 2 seconds, so nothing keeps
working after the lock is handed on. A program that starts its own session (a
daemon) escapes this, and native Windows has no such guard (use WSL 2). What a
node leaves running after it ends normally is left alone.

## Limits

The `issues` workflow takes at most 10 issues, builds and reviews each once, and
keeps its queue in files, so a resumed run starts the integrations over (an
issue already pushed is rebased again and finds nothing new). The `in-progress`
label is only a sign: two runs that start at the same moment can both take an
issue. It needs a checkout with a commit; `--in-place` runs the builders in one
checkout, which `issues` cannot work with. The register has the rest:
[conflict resolver](../../specs/gaps/conflict-resolver-limits.md),
[`issues`](../../specs/gaps/issues-limits.md) and
[locks](../../specs/gaps/machine-limits.md).

Details of how it works: [Integration](../../specs/integration.md).
