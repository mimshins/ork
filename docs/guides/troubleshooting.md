# Troubleshooting

Start with `ork doctor`: most problems are a missing tool or login, and it says
which. Below are the other messages you are likely to meet, and what to do.

## Setup

**`! claude (sdk driver)  no API key or cloud provider`.** The default driver
needs `ANTHROPIC_API_KEY`, or Bedrock or Vertex
([Accounts](./accounts.md#the-agent-sdk-driver-driver-sdk-the-default)). If your
`claude` login is ready instead, use the CLI driver: `--driver cli`, or
`defaults.driver: cli` in the workflow.

**`claude` is older than 2.1.281.** Update Claude Code. Older versions may not
read `AGENTS.md`, so a project with only `AGENTS.md` would run without its
instructions.

**`ork: command not found`.** Until the first release, Ork runs from a clone;
check the alias from
[Installation](../getting-started/installation.md#install-from-source-today),
and run `pnpm build` in the clone after pulling.

**Node version errors.** Ork needs Node 24.20 or later (`node --version`).

## Before a run starts

**`… need a git worktree, but … is not in a git repository with a commit`.**
Nodes with `isolation: worktree` need a repository with at least one commit. Run
`git init` and commit, or pass `--in-place` to run in the current folder.

**`These instructions, skills or agents have uncommitted changes …`.** Worktrees
only get committed files, so Ork stops rather than run agents on instructions
you are not seeing. Commit the listed files, or pass `--allow-dirty` to run with
the committed versions.

**`This workflow runs programs that are not installed`.** A `tool.gh`,
`tool.aws` or `tool.shell` node runs a program that is not on your `PATH`.
Integrations are optional, so Ork only asks for the ones a workflow uses:
install the program (and sign in with its own login), or take the node out.

**`missing required input "feature" (--input feature=…)`.** Pass every required
input: `--input feature="…"`.

**`ref.skill` or `ref.context` errors.** A skill or context path resolves to
nothing. Paths are relative to the workflow file, start with `./` or `../`, and
must stay inside the project; a skill path points at a folder with a `SKILL.md`.
Project skills are never listed: they load by themselves
([Skills and context](./skills-and-context.md)).

**A cycle without `maxRounds`.** Every loop needs a bound on one of its edges
([Writing workflows](./writing-workflows.md#loops)).

**`"x" uses worktree isolation, which a run on its own does not set up`.**
`ork run --node` sets up no worktrees. Add `--in-place`, or run the whole
workflow.

## During a run

**A run seems stuck.** It may be waiting on a question: `ork decide --list`
shows the open ones, and `ork logs <run>` shows `? asks: …` where it stopped. A
detached run always waits for `ork decide`. To end it, `ork stop <run>`.

**A loop used all its rounds.** Ork asks whether to stop (recommended), allow
one more round, or carry on along the other edges. Raise `maxRounds` if it
happens often, or tighten what the reviewers ask for.

**A node fails with `status: fail` and no report.** The session ended without a
valid report, often because it hit `maxTurns` or `budgetUsd`. Raise the limit,
or narrow the node's brief.

**The run ends `budget_exhausted`.** `limits.budgetUsd` is spent; no new session
starts. Raise it, or use cheaper models for checks
([Models, effort and budgets](./models-and-budgets.md)).

**A node fails because a git hook refused its commit.** Ork commits each node's
work with your repository's hooks. The node's message shows the hook's output,
and its worktree keeps the changes so you can fix them by hand.

**A merge conflict.** A child's branch conflicted with its owner's. The merge is
aborted, the owner is told, and the child's worktree stays: merge it yourself,
or let the owner redo the work.

**Tools are denied, or questions answer themselves.** Nobody is at the terminal
(for example in CI): tools that need permission are denied, questions take their
recommended option. Pre-approve tools with the node's `tools.allow`, or run in a
terminal.

## After a run

**Lots of `ork/` branches and worktrees.** `ork worktrees` lists them;
`ork worktrees clean` removes the merged ones, `--all` the rest, and
`--branches` deletes branches too ([Worktrees](./worktrees.md#cleaning-up)).

**I can't find the result.** It is on the root node's branch,
`ork/<run>/<node>`, in a worktree beside your clone; the run summary prints the
path. Ork never merges into your branch and never pushes.

## Still stuck?

See what a node's session loads with `ork context explain <wf> <node>`, rerun
with `--json` for every event, and
[open an issue](https://github.com/mimshins/ork/issues) with the output. Never
paste a token or a key.
