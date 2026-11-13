# Taking and running the `issues` workflow

_Part of [Working on issues in parallel](../issues-in-parallel.md)._

## Take the workflow

`ork init --issues` adds it to a new project as `.ork/workflows/issues.ork.yaml`
(on a terminal, `ork init` asks once; it never overwrites a file you changed).
In an existing project, run `ork init --issues` again, or download it like any
[example](../examples.md#issues).

**Commit it before the first run:** the builders' worktrees come from your
commits, so a workflow file that is not committed is not there for them.
`ork init --issues` says so when it writes the file.

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
The rest still go in. The run's outputs are `integrated`, `leftOut` and `url`,
and `ork run` prints them under its summary line:

```
✓ run 5e0c9b2a succeeded · $4.2210 · 9 ran, 0 skipped
  integrated: #1
  leftOut:
    #2: the builder failed
    #3: the review asked for changes
  url: https://github.com/acme/app/pull/57
```

`ork logs`, `ork attach` and the run's page in `ork ui` show the same. A value
that does not fit on a line goes under its key, and a value of more than 20
lines or 2,000 characters is cut: `… cut; full value: ork logs <run> --json`.

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
