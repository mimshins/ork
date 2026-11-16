# The flow

_Part of [`ork onboard`](./onboard.md)._

Status: **Built**.

The command (`packages/cli/src/commands/onboard.ts`, the steps in
`packages/cli/src/onboard/`) runs these steps in order. Everything before
[the cost preview](#the-cost-preview) is free: no session starts, no run is
recorded, and the only file it may write is what `ork init` writes when `.ork/`
is missing.

## Refusals

Each is one stderr line and exit 1, before anything is written or spent:

- **No terminal** (stdin or stderr is not a TTY):
  `ork onboard asks questions: run it in a terminal.` It has no flags for
  answers or picks.
- **An attached project** (`ork register`): it says to run `ork init` in the
  repository instead (attached projects are a [gap](../gaps/onboard-limits.md)).
- **No commit**: `headWarning`'s text, as `ork init` prints it; no run starts,
  since `ork:onboard-write` needs a worktree.
- **`--review` with `--fresh`**: `--review and --fresh can't be used together.`
- Then [doctor](./worktrees-agents-context-and-doctor.md#doctor)'s required
  checks (Node, git): a failed one stops with its detail and hint.

## Setting up

With no `.ork/`, the command records the project in-repo (`initRecorded`) and
runs `ork init`'s file steps (`ork init` run from a subfolder targets the git
root, and `prepare` reads the place again afterwards): the starter workflow and
the `.gitignore` entry, asking nothing else (`--no-skills`, `--no-issues`,
`--no-link`). The `.gitignore` edit stays in the working tree, uncommitted; the
closing text says to commit it with the branch. With an `.ork/`, nothing is
changed before the gate's keep.

The files that step writes are uncommitted, so on a first visit each of the two
runs prints
`warning N uncommitted change(s) in this checkout are not in the worktrees`. It
is expected: the writer's worktree branches from `HEAD`, lacks the starter, and
only adds files ([L400](../gaps/onboard-limits.md)).

## The driver

- `--driver <id>`: used as given; an id that is not a driver is refused with the
  known ids, one that is not ready with its login hint (exit 1).
- Otherwise exactly one ready driver is used with no question; several show a
  `select` (the one `ork run` would take recommended); none prints each driver's
  login hint and stops (exit 1).
- No session starts for any of this: readiness is `readyDriver`'s check, as
  `ork doctor` runs it.

Both built-in runs get `--driver <id>`, so they agree.

## The survey

`packages/cli/src/onboard/survey.ts` reads the project with no model and returns
a `Survey`:

| Field            | What it holds                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packageManager` | from the lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock[b]`), else `packageManager` in `package.json`, else `null`              |
| `scripts`        | `package.json`'s script names and commands, at most 40, each command cut to 120 characters                                                               |
| `checks`         | the scripts named `test`, `check`, `lint`, `typecheck`, `build` or starting with one of them and a `:`, as the command a node would run (`pnpm test`, …) |
| `ci`             | files under `.github/workflows/`, `.gitlab-ci.yml`, `.circleci/config.yml`, `azure-pipelines.yml`, `Jenkinsfile`, at most 20 paths                       |
| `baseBranch`     | `origin/HEAD`'s branch, else the current branch, else `null`                                                                                             |
| `gh`             | `true` when `gh auth status` exits 0, else `false`; its output is never read or kept                                                                     |
| `agents`         | agent folders that exist: `.claude/agents`, `.opencode/agents`, `.commandcode/agents`, `.ork/agents`, with their file names, at most 30                  |
| `skills`         | skill folders that exist (`.claude/skills`, `.opencode/skills`, `.commandcode/skills`, `.ork/skills`, `.agents/skills`), skill names, at most 30         |
| `instructions`   | which of `AGENTS.md`, `CLAUDE.md` exist at the root, and their sizes in lines                                                                            |
| `ork`            | `.ork/workflows/*.ork.yaml` names, whether `.ork/project.yaml` exists, the starter's presence                                                            |

Files are read as plain files inside the root (no link followed out of it). Its
text form (`surveyText`) is the one `survey` input of both built-ins and is
printed compactly before the questions; it is at most 12 KiB, every list cut
with `… N more`.

## Mode

Review when `.ork/workflows/` holds a workflow other than the starter
(`hello.ork.yaml`) **and** the store holds a run of this project; otherwise
first visit. `--review` and `--fresh` override it. The mode is printed
(`Mode: first visit` or `Mode: review (3 workflows, 41 runs)`) before any spend.

## The history digest

Review only. `packages/cli/src/onboard/history.ts` builds a `History` from the
store with no model, for this project only (another project's records are left
out), per workflow, newest first:

- runs by how they ended (`succeeded`, `failed`, `stopped`, budget exhausted),
- what they cost (dollars and tokens, from the usage ledger),
- the usage hints `ork usage` would show for it,
- open feedback items (id, kind, severity, title),
- open follow-ups (id, kind, title).

Its text form is the `history` input of `ork:onboard-propose` (empty on a first
visit), at most 16 KiB: a workflow's items past 20 are cut with `… N more`.

## The questions

Three fixed questions, asked with `readText` (an empty answer is kept as
`(no answer)`, Esc leaves it empty, Ctrl-C stops with exit 130 and nothing
written):

1. First visit: `What slows you down most in this project?` Review:
   `What went wrong lately with Ork's runs here?`
2. `What do you ship from this project, and how often?`
3. `How is a change reviewed before it lands?`

Each answer is cut to 2,000 characters. The `answers` input is the three as
`Q: <question>` and `A: <answer>` lines, blank-line separated.

## The cost preview

Before any session the command prints the most the paid part can spend: the sum
of both built-ins' `limits.budgetUsd` and of their `limits.budgetTokens`, read
from `builtinWorkflowText` (`packages/cli/src/onboard/caps.ts`), with each part:

```
The most this can spend: $<usd> or <tokens> tokens (propose $<a>, <n> tokens; write $<b>, <m> tokens).
Start? [y/N]
```

Only a yes starts. No ends with exit 0: the survey already printed, nothing
written, no run in the store. A `command-code` run is held by the tokens cap,
since it reports no dollars.

## Proposing and picking

1. `ork:onboard-propose` runs with inputs `survey`, `answers` and `history`, all
   passed as untrusted (`untrusted:` on `runWorkflowFile`). Its questions
   (`ask_user`) are asked on this terminal, as `ork run`'s are.
2. Its `filter` node's stdout is the [filter result](./onboard-verbs.md#filter);
   the command reads it from the node's output in the store.
3. The survivors are shown, each with its workflow name, why, where a person
   decides, its caps and its evidence; dropped ones with their reasons, dimmed.
4. A [`multiselect`](./terminal.md#prompts) takes any number. Picking none ends
   with exit 0 and `Nothing picked; nothing written.`; no survivor at all ends
   with exit 0 and `Nothing to write: no suggestion survived the checks.`, with
   no prompt. Either way nothing is written and the propose run stays in the
   store.

## Writing and the gate

1. `ork:onboard-write` runs with `picks` (the picked suggestions as a JSON
   array), `survey` and `answers`, untrusted. Its nodes: `format`, the `write`
   worker in its own worktree, `finish`, looping back to `write` while `finish`
   fails, at most 3 rounds, then the gate. The writer therefore runs at most 4
   sessions: the first go and `maxRounds: 3`.
2. Out of rounds, the run asks as any loop does (stop, one more round, onward);
   stop or onward ends the run failed, and the command prints the problems
   `finish` last printed and the run id. A failed run keeps its worktree and
   branch, for `ork resume <run>`; only a discard, or a branch with no commits,
   removes them.
3. The gate shows the diff stat, `finish`'s "needs your eye" list (every new
   allow rule, `env` entry and network tool call), and says the writer is held
   to `.ork/` by a check on the worktree, not a sandbox (G14). Its options are
   `keep` and `discard`.
4. Settled as `ork feedback apply` is, with the code in
   `packages/cli/src/runs/apply.ts` (`outcomeOf`, `keptBranch`, `discardRun`,
   `commitsAhead`) shared, not copied:
   - **keep**: the branch stays; the command prints it, `Ork never merges`, the
     feedback item ids the kept suggestions cited (none is resolved), and to
     commit the `.gitignore` edit with it when there is one.
   - **discard**: the run's worktree and branch are removed.
   - A branch with no commits ahead is nothing to keep: removed, and said.

The working tree's `.ork/` is never changed by the paid part: the writer works
only in its worktree.

## Errors

One line each: no terminal, attached, no commit, no ready driver (with the login
hint), an unknown `--driver`, `--review` with `--fresh`, a failed run (its run
id, so `ork resume <run>` resumes that run; the command's own steps start over,
a [gap](../gaps/onboard-limits.md)), out of rounds (the problems `finish` last
printed).
