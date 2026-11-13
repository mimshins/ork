# Locks, conflicts and limits of `issues`

_Part of [Working on issues in parallel](../issues-in-parallel.md)._

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

`held by <run>/<node>` names the node that **took** the lock, not the node that
runs now: the run holds the lock until its last node that names it ends, so the
node shown may have ended while a later one of that run is working.

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
  [`resolve-conflict`](../../../examples/resolve-conflict.ork.yaml), which you
  can copy into your workflow's nodes, or run alone in a checkout where a rebase
  has stopped.

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
checkout, which `issues` cannot work with. Its `check` node runs your check with
`eval`, which Ork does not read, so it takes no
[heavy slot](../running-workflows/several-runs.md#what-waits). The register has
the rest: [conflict resolver](../../../specs/gaps/conflict-resolver-limits.md),
[`issues`](../../../specs/gaps/issues-limits.md) and
[locks](../../../specs/gaps/machine-limits.md).

Details of how it works: [Integration](../../../specs/integration.md).
