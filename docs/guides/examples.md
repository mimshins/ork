# The example workflows

Two workflows in [`examples/`](../../examples/) show Ork's main patterns end to
end. Both stop for your go-ahead before anything leaves your machine.

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
6. A gate asks you whether to push the branch and open a pull request: `ship`
   after an approval (recommended `open`), `escalated` otherwise (recommended
   `keep`).
7. On `open`, `git push` and `gh pr create` run with your own logins. You review
   and merge on GitHub.

```sh
ork run examples/software-factory.ork.yaml --input feature="Add a farewell(name) function beside greet, with a test"
```

It uses opus for the spec, the builder, security and the approver, and sonnet
elsewhere, within a run budget of $20. For a first try, copy it into
`.ork/workflows/` with `examples/skills` and `examples/context` beside it, set
the models to `haiku` and `limits.budgetUsd` lower; a small feature then costs a
few cents. Allow the builder what it needs to work without asking, for example:

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

```sh
gh pr checkout 42
ork run examples/pr-review.ork.yaml --input pr=42
```

`--input base=develop` reviews against another branch. It uses sonnet within a
run budget of $5.

## Running them unattended

With `--detach`, the run carries on without a terminal and its questions wait in
`ork decide`, gates included, so nothing is pushed or posted until you answer.
Read-only nodes cannot run commands (`readonly` denies Bash), so reviewers read
the code instead of running `git` or the tests.

Both examples run on either driver: `--driver cli` uses your logged-in `claude`;
`--driver sdk` needs `ANTHROPIC_API_KEY` (or Bedrock or Vertex)
([accounts](./accounts.md)).
