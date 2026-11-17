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
- **An attached project** (`ork register`): it says to run `ork migrate`, which
  moves Ork's files into the repository's `.ork/`, then `ork onboard`
  ([ADR-099](../../decisions/ADR-099-onboard-refuses-attached-projects.md);
  attached projects are a [gap](../gaps/onboard-limits.md)).
- **No commit**: `headWarning`'s text, as `ork init` prints it; no run starts,
  since `ork:onboard-write` needs a worktree.
- **`--review` with `--fresh`**: `--review and --fresh can't be used together.`
- Then [doctor](./worktrees-agents-context-and-doctor.md#doctor)'s required
  checks (Node, git): a failed one stops with its detail and hint.

## The driver

Picked right after the refusals and before anything is written, so a stop here
leaves the project folder as it was (no `.ork/`, no `.gitignore` edit, no
`created` line):

- `--driver <id>`: used as given; an id that is not a driver is refused with the
  known ids, one that is not ready with its login hint (exit 1).
- Otherwise exactly one ready driver is used with no question; several show a
  `select` (the one `ork run` would take recommended); none prints each driver's
  login hint and stops (exit 1).
- No session starts for any of this: readiness is `readyDriver`'s check, as
  `ork doctor` runs it.

Both built-in runs get `--driver <id>`, so they agree.

## Setting up

With a driver and no `.ork/`, the command records the project in-repo
(`initRecorded`) and runs `ork init`'s file steps (`ork init` run from a
subfolder targets the git root, and `prepare` reads the place again afterwards):
the starter workflow and the `.gitignore` entry, asking nothing else
(`--no-skills`, `--no-issues`, `--no-link`). The `.gitignore` edit stays in the
working tree, uncommitted; the closing text says to commit it with the branch.
With an `.ork/`, nothing is changed before the gate's keep.

The files that step writes are uncommitted, so on a first visit each of the two
runs prints
`warning N uncommitted change(s) in this checkout are not in the worktrees`. It
is expected: the writer's worktree branches from `HEAD`, lacks the starter, and
only adds files ([L400](../gaps/onboard-limits.md)).

`prepare` keeps in `Prepared.fromInit` the files of the project root that the
writer's worktree (cut from `HEAD`) lacks: what `ork init` made when this
command set `.ork/` up (the starter file and the `.gitignore` line), and,
always, the paths under `.ork/` and `.gitignore` that
`git status --porcelain --untracked-files=all` reports (modified or untracked;
ignored ones such as `.ork/runs/` and deleted ones are left out), merged with no
duplicates (`uncommittedFiles`, `withUncommitted`). A failing `git status` (not
a repository, no git) adds nothing and is never an error. `runWrite` adds one
note to the writer's `survey` input (`initNote`): "Not in your worktree: these
files in the project folder are uncommitted (…), so your worktree does not hold
them; do not look for them or recreate them." With none, `fromInit` is empty and
the survey is sent as it is.

## The survey

`packages/cli/src/onboard/survey.ts` reads the project with no model and returns
a `Survey`:

| Field              | What it holds                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packageManagers`  | `packageManager` in `package.json` (one line, at most 60 characters), then one per lockfile or manifest found (`pnpm-lock.yaml`, `Cargo.toml`, `go.mod`, …)                                                                                                                                                                                                                                      |
| `scripts`          | `package.json`'s scripts, the first 30, each name cut to 60 and command to 100 characters, on one line                                                                                                                                                                                                                                                                                           |
| `testCommands`     | scripts named `test`, `tests`, `e2e` or `spec` (or starting with one and `:`), `make` targets `test`/`tests`, `cargo test`, `go test ./...`; at most 20                                                                                                                                                                                                                                          |
| `checkCommands`    | scripts named `check`, `lint`, `typecheck`, `build`, `verify`, `ci`, `validate`, `format` (or starting with one and `:`), other `make` targets; at most 20                                                                                                                                                                                                                                       |
| `ciFiles`          | `.github/workflows/*.yml\|yaml` and a fixed list of other CI files (`.gitlab-ci.yml`, `.circleci/config.yml`, `Jenkinsfile`, …); at most 20                                                                                                                                                                                                                                                      |
| `baseBranch`       | `origin/HEAD`'s branch, else `main`, `master`, `trunk` or `develop` if it exists, else the current branch, else `null`                                                                                                                                                                                                                                                                           |
| `ghUsable`         | `true` when `ork doctor`'s `gh` check says logged in, else `false`; its detail is never read or kept                                                                                                                                                                                                                                                                                             |
| `instructionFiles` | which of `AGENTS.md`, `CLAUDE.md` exist at the root                                                                                                                                                                                                                                                                                                                                              |
| `agentFolders`     | the agent and skill folders of `.ork/`, `.claude/`, `.agents/`, `.opencode/` and `.ai/` that hold something, 20 names each with `and N more`; a folder linked to `.ork/` is listed once                                                                                                                                                                                                          |
| `ork`              | whether `.ork/` and `.ork/project.yaml` exist, and the names of its workflows (`*.ork.yaml`), agents and skills, at most 20 each                                                                                                                                                                                                                                                                 |
| `history`          | the git digest (`survey-git.ts`): the last 20 commit subjects (`git log -n 20 --format=%s`), the newest 10 tags, and the 10 paths changed most in the last 200 commits; `Recent history: no commits` in a repository with none (`git log` fails and `git rev-parse --git-dir` succeeds); `null` ("unavailable") outside a repository or when git fails. Subjects only: no author, email or hash. |

Files are read as plain files inside the root (no link followed out of it, none
over 256 KiB), and every name is cut to one line of at most 60 or 100
characters. Its text form (`surveyText`) is the one `survey` input of both
built-ins and is at most 6,000 characters, cut at the end with `…`. The history
line is last, after `.ork/`, so a cut takes the digest first. Each digest line
goes through the shared secret scrubber
([ADR-091](../../decisions/ADR-091-shared-secret-patterns-and-scrubber-in-core.md))
before it is kept, since commit subjects, tags and paths go to the model
provider with the rest of the survey. The lists are capped without a note, and
where the limits bite, see [L406 to L412](../gaps/onboard-limits.md).

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

A driver that reports no dollars (its `price` capability, from
`@krapht/ork-integrations`; today `command-code`) gets the tokens alone, with no
dollar figure and no price table:

```
The most this can spend: <tokens> tokens (this driver reports no dollars, so only the token caps hold; propose <n>, write <m>).
```

`claude-code` and `open-code` report dollars and keep the first line. On a
no-dollars driver `ork validate` warns (`driver.budget`) that `budgetUsd` and
`limits.budgetUsd` cannot see its sessions, and each session stops at its
`budgetTokens`.

Only a yes starts. No ends with exit 0: the survey already printed, nothing
written, no run in the store.

## Proposing and picking

1. `ork:onboard-propose` runs with inputs `survey`, `answers` and `history`, all
   passed as untrusted (`untrusted:` on `runWorkflowFile`). Its questions
   (`ask_user`) are asked on this terminal, as `ork run`'s are.
2. The run has one node, `propose`. The command reads its `suggestions` from the
   run's result (a missing or non-list value is an empty list) and checks them
   in this process, against the project root, with
   [the filter](./onboard-verbs.md#the-filter); no tool node or argument carries
   the list, so its size is not limited by one. Run alone, the workflow returns
   the proposer's list unfiltered ([L405](../gaps/onboard-limits.md)).
3. The survivors are shown, each with its workflow name, why, where a person
   decides, its caps and its evidence; dropped ones with their reasons, dimmed.
4. A [`multiselect`](./terminal.md#prompts) takes any number. Picking none ends
   with exit 0 and `Nothing picked; nothing written.`; no survivor at all ends
   with exit 0 and `Nothing to write: no suggestion survived the checks.`, with
   no prompt. Either way nothing is written and the propose run stays in the
   store.
5. Ctrl-C at the pick stops with exit 130, nothing written, and prints the
   propose run's id, what it spent (dollars where the driver reports them,
   tokens always, from the run's result) and
   ``Run `ork onboard` again to pick from it.`` The run stays in the store; the
   next visit [offers it](./onboard-saved.md#a-saved-proposal). A propose run
   that fails, stops or crashes before that is offered for
   [resuming](./onboard-saved.md#an-unfinished-proposal), and its failure text
   names `ork resume <run>`.

## Writing and the gate

1. `ork:onboard-write` runs with `picks` (the picked suggestions as a JSON
   array), `survey` and `answers`, untrusted. Its nodes: `format`, the `write`
   worker in its own worktree, `finish`, looping back to `write` when `finish`
   exits 1 (`when: exitCode == 1`: it found problems), at most 3 rounds, then
   the gate. The writer therefore runs at most 4 sessions: the first go and
   `maxRounds: 3`. Any other exit of `finish` (127 when `ork` cannot be found, a
   timeout, a signal) takes no edge: the run ends failed with the tool's own
   error and the writer is not run again. A Node crash inside `finish` exits 1
   and still loops ([L403](../gaps/onboard-limits.md)).
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
id, so `ork resume <run>` resumes that run; after a failed propose run the next
`ork onboard` offers to resume it,
[an unfinished proposal](./onboard-saved.md#an-unfinished-proposal)), out of
rounds (the problems `finish` last printed).
