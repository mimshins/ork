# The example workflows

The example workflows show Ork's main patterns end to end. They live in Ork's
repository, in [`examples/`](../../examples/), not in the npm package, so each
section below starts with a command that downloads the example into your
project's `.ork/workflows/`, from the release that matches your `ork --version`.
Run it inside your project. (In a clone of Ork, run `examples/<name>.ork.yaml`
straight from there.)

The first two, `software-factory` and `pr-review`, stop for your go-ahead before
anything leaves your machine. They keep their roles as [agents](./agents.md) in
the workflow's own `agents:` section, and their nodes take them: the `security`
node is the `security-reviewer` agent with the task "review the builder's
branch".

## software-factory

[`software-factory.ork.yaml`](../../examples/software-factory.ork.yaml) builds a
feature:

1. `spec` writes a spec in your checkout (`shared`).
2. `builder`, a leader in its own worktree, implements it.
3. `security`, `ux` and `code`, the builder's children, review its branch in
   parallel (`readonly`), and may message each other.
4. If any asks for changes, the builder gets another round, at most two; then
   you decide.
5. `approver` judges the branch (readonly, it works in the builder's worktree)
   and reports `approve` or `escalate`.
6. A gate asks you whether to push the branch and open a pull request. After an
   approval it recommends **open**; after an escalation, **keep**.
7. On **open**, `git push` and `gh pr create` run with your own logins. You
   review and merge on GitHub.

It reads a skill and a context file beside it, so download all three:

```sh
v=$(ork --version)
base="https://raw.githubusercontent.com/mimshins/ork/@krapht/ork@$v/examples"
curl -fsSL --create-dirs -o .ork/workflows/software-factory.ork.yaml "$base/software-factory.ork.yaml"
curl -fsSL --create-dirs -o .ork/workflows/skills/review-checklist/SKILL.md "$base/skills/review-checklist/SKILL.md"
curl -fsSL --create-dirs -o .ork/workflows/context/house-style.md "$base/context/house-style.md"
ork run software-factory --input feature="Add a farewell(name) function beside greet, with a test"
```

It runs on the claude-code driver, your own `claude`. Its agents use opus for
the spec, the builder, security and the approver, and sonnet elsewhere, within a
run budget of $20. For a first try, set the agents' models to `haiku` and
`limits.budgetUsd` lower; a small feature then costs a few cents. Allow the
builder what it needs to work without asking, for example:

```yaml
builder:
  tools:
    allow: [Edit, Write, "Bash(npm test:*)"]
```

## pr-review

[`pr-review.ork.yaml`](../../examples/pr-review.ork.yaml) reviews a pull request
you have checked out:

1. `diff` runs `git diff <base>...HEAD`.
2. `security` and `correctness` review it in parallel, read-only.
3. `summary` (haiku) writes one comment from both reviews.
4. A gate shows you the comment and asks whether to post it; `keep` is
   recommended.
5. On `post`, `gh pr comment` posts it with your login.

Sonnet, within a run budget of $5:

```sh
v=$(ork --version)
curl -fsSL --create-dirs -o .ork/workflows/pr-review.ork.yaml \
  "https://raw.githubusercontent.com/mimshins/ork/@krapht/ork@$v/examples/pr-review.ork.yaml"
gh pr checkout 42
ork run pr-review --input pr=42
```

`--input base=develop` reviews against another branch.

## across-projects

[`across-projects.ork.yaml`](../../examples/across-projects.ork.yaml) builds a
change in this project and calls a workflow in another, with the two sessions
talking by name while they work. It needs a registered project with the id
`client-kit` and a workflow `feature` there, whose `builder` is a leader or
worker. `ork validate` warns until the project is registered. See
[Working across projects](./working-across-projects.md#calling-a-workflow).
Sonnet, within a run budget of $5:

```sh
v=$(ork --version)
curl -fsSL --create-dirs -o .ork/workflows/across-projects.ork.yaml \
  "https://raw.githubusercontent.com/mimshins/ork/@krapht/ork@$v/examples/across-projects.ork.yaml"
ork run across-projects --input feature="Add a farewell endpoint"
```

## checked-build

[`checked-build.ork.yaml`](../../examples/checked-build.ork.yaml) has a session
build while programs check its work and tell it what they found, with no model
turn to carry the news. It needs `./scripts/check.sh` in your project and
`CI_TOKEN` set. See [Scripts in a workflow](./scripts.md). Sonnet, with a $1
budget per session:

```sh
v=$(ork --version)
curl -fsSL --create-dirs -o .ork/workflows/checked-build.ork.yaml \
  "https://raw.githubusercontent.com/mimshins/ork/@krapht/ork@$v/examples/checked-build.ork.yaml"
ork run checked-build
```

## wait-for-ci

[`wait-for-ci.ork.yaml`](../../examples/wait-for-ci.ork.yaml) watches a pull
request's checks with no model turn, and starts a session only if one fails. It
looks every 30 seconds for up to 2 hours, and after a fix it watches again, at
most three times. See [Watching a source](./watching.md). Within a run budget of
$5:

```sh
v=$(ork --version)
curl -fsSL --create-dirs -o .ork/workflows/wait-for-ci.ork.yaml \
  "https://raw.githubusercontent.com/mimshins/ork/@krapht/ork@$v/examples/wait-for-ci.ork.yaml"
ork run wait-for-ci --input pr=12
```

## Running them unattended

With `--detach`, the run carries on without a terminal and its questions wait in
`ork decide` and the Decisions panel of `ork ui`, gates included, so nothing is
pushed or posted until you answer. Read-only nodes run read-only git
(`git diff`, `log`, `show`, `status`) without asking; any other command, such as
the tests, asks you first.

Every example runs on the claude-code driver: your own `claude`, logged in or
with `ANTHROPIC_API_KEY` (or Bedrock, Vertex or Foundry) set
([accounts](./accounts.md)).

## fan-out

[`fan-out.ork.yaml`](../../examples/fan-out.ork.yaml) splits a goal into
independent tasks and builds them at the same time:

1. `plan` (readonly) reports a list of tasks, up to six, with a title and a
   detail each.
2. `build` runs once per task, three at a time, each in its own worktree
   ([once per item](./writing-workflows/running-per-item.md)).
3. A gate shows you every task's result, with its branch, and asks which you
   keep. Nothing is merged for you. The edge into it reads
   `when: any(statuses, 'pass')`, so the gate still runs when some tasks failed
   and others passed; without a `when:`, one failed task ends the run before the
   gate. If every task failed, the run fails.

```sh
v=$(ork --version)
curl -fsSL --create-dirs -o .ork/workflows/fan-out.ork.yaml \
  "https://raw.githubusercontent.com/mimshins/ork/@krapht/ork@$v/examples/fan-out.ork.yaml"
ork run fan-out --input goal="Add a farewell(name) function and a test for it"
```

Sonnet, within a run budget of $10. Each task is a session, so lower `maxItems`
for a first try.

## issues

[`issues.ork.yaml`](../../examples/issues.ork.yaml) works GitHub issues in
parallel: a builder and a reviewer per issue, then the ones that pass are
integrated one at a time into one branch under its lock, with one pull request
that closes them. `ork init --issues` adds it to a project. The whole flow is in
[Working on issues in parallel](./issues-in-parallel.md).

```sh
v=$(ork --version)
curl -fsSL --create-dirs -o .ork/workflows/issues.ork.yaml \
  "https://raw.githubusercontent.com/mimshins/ork/@krapht/ork@$v/examples/issues.ork.yaml"
ork run issues --input label=ready --input check="pnpm run check"
```

Sonnet, within a run budget of $40; at most 10 issues. It needs `gh` and Claude
Code signed in.

## resolve-conflict

[`resolve-conflict.ork.yaml`](../../examples/resolve-conflict.ork.yaml) resolves
a rebase that stopped on conflicts, in the checkout where it stopped: an agent
edits only the conflicted files, you are asked only when the resolution changes
what a reviewed change does, then the rebase finishes and your check runs. Run
it alone, or copy its nodes into a workflow that integrates, as `issues` does.

```sh
v=$(ork --version)
curl -fsSL --create-dirs -o .ork/workflows/resolve-conflict.ork.yaml \
  "https://raw.githubusercontent.com/mimshins/ork/@krapht/ork@$v/examples/resolve-conflict.ork.yaml"
ork run resolve-conflict --input check="pnpm run check"
```
