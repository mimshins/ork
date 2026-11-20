# Onboarding: `ork onboard`

`ork onboard` reads your project, asks what slows you down, proposes workflows
that fit, writes the ones you pick on a branch (in Ork's own folder, for a
project attached with `ork register`), and stops at a gate that shows the diff.
Ork never merges. Run it again in a project that already has workflows and runs,
and it reviews what those runs showed and may change one.

`ork init` gives every project the same starter. This is for the next step: the
workflows that fit your project.

It needs a terminal, git with at least one commit, and one ready agent driver
(`ork doctor` says which). It has no flags for the answers or the picks.

```sh
ork onboard                       # asks which driver when several are ready
ork onboard --driver open-code    # skips that question
ork onboard --review              # review mode, even with nothing to review
ork onboard --fresh               # first-visit mode, no saved or unfinished proposal
```

`--review` and `--fresh` together are refused. The global `--plain` asks line by
line ([the terminal](./terminal.md)).

## Contents

- [What it does, in order](#what-it-does-in-order)
- [In a project attached with `ork register`](#in-a-project-attached-with-ork-register)
- [First visit and review](#first-visit-and-review)
- [The three questions](#the-three-questions)
- [What it costs](#what-it-costs)
- [Proposing, picking, writing](#proposing-picking-writing)
- [A saved proposal](#a-saved-proposal)
- [The gate, the checks and the limits](./onboarding/the-gate-and-its-checks.md):
  the gate, what is checked and what is only asked for, what each driver loads,
  credentials, limits

## What it does, in order

1. **Checks.** No terminal or no commit each print one line and stop, with
   nothing written and nothing spent. A project attached with `ork register`
   works too ([below](#in-a-project-attached-with-ork-register)).
2. **Picks the driver.** `--driver <id>` skips the question; one ready driver is
   used; several show a list; none prints how to log in and stops, before
   anything is written: your project folder is as it was. Don't pick `codex` or
   `omp`: onboarding's workflows set a turn limit, which neither can hold, so
   the run is refused before any session starts (and `omp` is not yet proven, so
   it is refused anyway).
3. **Sets up `.ork/`** like `ork init` when it is missing (the starter, the
   `.gitignore` entry). That `.gitignore` edit stays in your working tree,
   uncommitted: commit it with the branch. On a first visit the runs then print
   `warning N uncommitted change(s) in this checkout are not in the worktrees`;
   that is expected, since the writer only adds files. The writer is told so, so
   it does not look for the starter or the `.gitignore` line in its worktree. It
   is told the same of any other uncommitted file under `.ork/` (or your
   `.gitignore`), whether `ork onboard` just made it or you did: its worktree is
   cut from your last commit and does not hold them.
4. **Surveys the project** with no model: package manager, scripts, the test and
   check commands, CI files, the base branch, whether `gh` is usable (never its
   output), the agent and skill folders, `AGENTS.md` and `CLAUDE.md`, what
   `.ork/` holds, and a short digest of recent history (below). It is cut to a
   bounded size and printed.
5. **Asks three questions** and shows the mode. Nothing so far is paid. If you
   left a proposal at the pick, it offers that first
   ([a saved proposal](#a-saved-proposal)).
6. **Shows the most it can spend** and waits for a yes.
7. **Proposes**, picks, **writes**, checks, and ends at the gate.

Everything before step 6 is free: no session starts and no run is recorded. A
"no" at step 6 ends with exit 0 and nothing written.

**What goes to the model provider.** The survey, your three answers and, in
review mode, the digest of your past runs go to the agents of the two built-in
runs, as data. The survey's recent-history line is the last 20 commit subjects,
the newest 10 release tags and the 10 paths changed most in the last 200
commits: no author names, emails or hashes. Ork masks anything in them that
looks like a secret (tokens and keys in common formats) before they leave, but a
secret in a commit subject that matches no pattern would still go, so look at
the survey it prints. A repository with no commits says `no commits`; if `git`
cannot read the history, the line says `unavailable`.

## In a project attached with `ork register`

`ork onboard` works in an attached project ([Projects](./projects.md)). Ork's
files for it live in `~/.ork/projects/<id>/`, and onboarding writes the
workflows you pick and the rules there, never into your repository: no `.ork/`,
no branch, no `.gitignore` edit. It still needs git with a commit, since the
writer works in a worktree of it.

- The writer starts with your current workflows and `project.yaml` from Ork's
  folder, so it edits what you have instead of writing blind, and the checks
  treat what they already name (a driver, a model, an agent) as yours.
- **keep** copies the writer's files into `~/.ork/projects/<id>/`; **discard**
  leaves that folder as it was. If you changed one of those files while the
  writer worked, keep copies nothing and says which; run `ork onboard` again.
- Like in a repository, the writer sees your last commit: uncommitted files are
  not in its worktree.

## First visit and review

If `.ork/workflows/` holds a workflow other than the starter `hello` **and** the
project has a run, you get review mode; otherwise, first visit. The mode is
printed before anything is spent.

In review mode Ork also reads your history, with no model and for this project
only: per workflow, how its runs ended, what they cost, the hints `ork usage`
would show, the open feedback items and the open follow-ups. A proposal may then
change an existing workflow, not only add one.

## The three questions

| First visit                                        | Review                                       |
| -------------------------------------------------- | -------------------------------------------- |
| What slows you down most in this project?          | What went wrong lately with Ork's runs here? |
| What do you ship from this project, and how often? | (same)                                       |
| How is a change reviewed before it lands?          | (same)                                       |

An empty answer is kept as `(no answer)`; each is cut to 2,000 characters.
Ctrl-C stops with nothing written. The answers, like the survey, go to the
agents as data: they are never instructions.

## What it costs

Before any session Ork prints the most the paid part can spend: the sum of the
two built-in workflows' caps, in dollars and in tokens, then asks `Start?` and
starts only on a yes.

```
The most this can spend: $<usd> or <tokens> tokens (propose $<a>, <n> tokens; write $<b>, <m> tokens).
```

`ork:onboard-propose` and `ork:onboard-write` each set `limits.budgetUsd` and
`limits.budgetTokens`. Command Code reports no dollars, so a run there is held
by tokens, and the line says so and shows tokens only:

```
The most this can spend: <tokens> tokens (this driver reports no dollars, so only the token caps hold; propose <n>, write <m>).
```

`ork usage` adds the runs up like any others.

## Proposing, picking, writing

- **Propose** (`ork:onboard-propose`): an agent with reading tools only (Ork's
  `extract`, and `Read` for images) and no shell reads your repository and may
  ask you up to three follow-up questions. For each workflow it gives why, where
  a person decides, its caps, evidence (a file or a commit) and, optionally, the
  commands it would run.
- **Filter:** `ork onboard` drops a suggestion that cites a file or commit that
  does not exist, or drafts a command whose program is not on your `PATH` or
  whose package script is not in your `package.json`. Nothing the agent drafted
  runs. (`ork run ork:onboard-propose` on its own returns the agent's list
  unfiltered; the filter is part of `ork onboard`.)
- **Pick:** the survivors are listed with their evidence; a pick-several prompt
  takes any number (Space toggles, Enter confirms, or `1,3` with `--plain`).
  Picking none ends cleanly with nothing written. Ctrl-C at the pick stops with
  exit 130 and says which run holds the proposal, what it spent (dollars where
  the driver reports them, tokens always) and
  ``run `ork onboard` again to pick from it``.
- **Write** (`ork:onboard-write`): a writer with no shell works in its own
  worktree. It is given a reference for the workflow format (node types, who
  owns what, edges and `maxRounds`, gates, the entry node, caps) with one small
  valid workflow, so it does not have to guess the file's shape. Ork then checks
  its work ([the gate and its checks](./onboarding/the-gate-and-its-checks.md))
  and sends problems back to the writer, up to 3 rounds. Out of rounds, the run
  ends failed and the command prints the problems and the run id
  (`ork resume <run>` resumes that run). If the check itself cannot start (`ork`
  is not found, say), the run ends failed at once with that error and the writer
  is not run again.

Every written workflow carries a dollar and a token cap, names no `driver` or
`model` (the machine running it picks), and uses only the built-in
`ork-implementer` and `ork-reviewer` agents; it writes no `.ork/agents/` file.
An edit to a workflow you already have keeps the driver, model and agents it
names.

## A saved proposal

The proposal stays in Ork's store after you leave the pick, by Ctrl-C or by
picking nothing. The next `ork onboard` in the same project finds the newest
proposing run that no writing run followed, says how old it is and asks whether
to use it:

```
A proposal from 3h ago is saved (run <id>); it was read from the files as they were then.
Use it, and skip the questions and the proposing run? Writing then costs at most <the write cap>.
```

Yes skips the questions, the preview and the paid proposing run, and goes to the
pick with the survey and answers of that run. Its suggestions are checked again
against your files as they are now, so one whose evidence is gone is dropped and
shown with why. No, or `--fresh`, starts as before. Nothing new is written to
disk for this: Ork reads its own record of the run.

If the newest proposing run did not finish (it failed, was stopped or crashed),
the next `ork onboard` offers to resume it instead, when `ork resume` could
continue it:

```
An unfinished proposal from 3h ago (run <id>, failed) can be resumed.
Resume it, and skip the questions? Spent so far <spent>; it can spend up to <the propose cap> in total.
```

Yes continues that same run, with the survey and answers it started with, on the
driver picked now, and goes to the pick when it succeeds. No, or `--fresh`,
starts as before, with a new run. A run that is still running is never offered,
nor one that used its budget: resumed, it would stop at once, since its budget
counts what it already spent.
