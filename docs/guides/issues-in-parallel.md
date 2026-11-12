# Working on issues in parallel

Several GitHub issues at once: an agent builds each in its own worktree, a
reviewer checks each, and the ones that pass are integrated one at a time into
one branch, with one pull request that closes them. Ork's `issues` workflow does
this, and a **lock** is what lets many runs, or many agents, work toward one
branch without their pushes colliding.

You need the `gh` command signed in (`gh auth status`) and a git remote named
`origin`. Ork reads no token: labels, pull requests and pushes go through your
own `gh` and git.

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

Or name them: `--input issues=12,15,18`. At most 10 are taken, since each costs
a builder and a reviewer. The branch they go into is `ork/issues` unless you
pass `--input branch=<name>`; the pull request goes to `main` unless you pass
`--input base=<name>`.

What happens:

1. Each issue gets the `in-progress` label, so you and your team see it is
   taken.
2. A builder takes each issue in its own worktree (three at a time) and makes
   the change with its tests.
3. A reviewer reads each change. One that is not approved is left out.
4. The approved ones are integrated **one at a time** into the branch: each is
   rebased onto the branch as the one before left it, your check runs, and it is
   pushed as one commit, `Resolve #12: <title>`.
5. One pull request is opened (or updated) with `Closes #12`, `Closes #15`, … in
   its body. The labels come off.

An issue whose builder failed, whose review asked for changes, or whose
integration could not finish is **left out**: it loses its label, its work stays
on its own branch, and the run's summary names it and why. The rest still go in.
The run's outputs are `integrated`, `leftOut` and `url`.

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
inputs:
  branch:
    type: string
    default: ork/issues
nodes:
  fetch:
    type: tool.shell
    script: git fetch origin "$BRANCH" && git rebase FETCH_HEAD
    lock: "branch:{{inputs.branch}}"
  check:
    type: tool.shell
    script: pnpm run check
    lock: "branch:{{inputs.branch}}"
  push:
    type: tool.shell
    script: git push origin "HEAD:refs/heads/$BRANCH"
    lock: "branch:{{inputs.branch}}"
```

The run takes the lock before the first node that names it and keeps it until
the last one ends (or the run does). So `fetch`, `check` and `push` happen with
no other run integrating the same branch in between. Rules:

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

## Limits

The `issues` workflow takes at most 10 issues, builds and reviews each once, and
keeps its queue in files, so a resumed run starts the integrations over (an
issue already pushed is rebased again and finds nothing new). The register has
the rest: [conflict resolver](../../specs/gaps/conflict-resolver-limits.md),
[`issues`](../../specs/gaps/issues-limits.md) and
[locks](../../specs/gaps/machine-limits.md).

Details of how it works: [Integration](../../specs/integration.md).
