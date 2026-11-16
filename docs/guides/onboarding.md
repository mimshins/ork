# Onboarding: `ork onboard`

`ork onboard` reads your project, asks what slows you down, proposes workflows
that fit, writes the ones you pick on a branch, and stops at a gate that shows
the diff. Ork never merges. Run it again in a project that already has workflows
and runs, and it reviews what those runs showed and may change one.

`ork init` gives every project the same starter. This is for the next step: the
workflows that fit your project.

It needs a terminal, git with at least one commit, and one ready agent driver
(`ork doctor` says which). It has no flags for the answers or the picks.

```sh
ork onboard                       # asks which driver when several are ready
ork onboard --driver open-code    # skips that question
ork onboard --review              # review mode, even with nothing to review
ork onboard --fresh               # first-visit mode, even with runs to review
```

`--review` and `--fresh` together are refused. The global `--plain` asks line by
line ([the terminal](./terminal.md)).

## What it does, in order

1. **Checks.** No terminal, an attached project (`ork register`) or no commit
   each print one line and stop, with nothing written and nothing spent. An
   attached project is not supported yet: run `ork init` in the repository.
2. **Sets up `.ork/`** like `ork init` when it is missing (the starter, the
   `.gitignore` entry). That `.gitignore` edit stays in your working tree,
   uncommitted: commit it with the branch. On a first visit the runs then print
   `warning N uncommitted change(s) in this checkout are not in the worktrees`;
   that is expected, since the writer only adds files.
3. **Picks the driver.** `--driver <id>` skips the question; one ready driver is
   used; several show a list; none prints how to log in and stops.
4. **Surveys the project** with no model: package manager, scripts, the test and
   check commands, CI files, the base branch, whether `gh` is usable (never its
   output), the agent and skill folders, `AGENTS.md` and `CLAUDE.md`, and what
   `.ork/` holds. It is cut to a bounded size and printed.
5. **Asks three questions** and shows the mode. Nothing so far is paid.
6. **Shows the most it can spend** and waits for a yes.
7. **Proposes**, picks, **writes**, checks, and ends at the gate.

Everything before step 6 is free: no session starts and no run is recorded. A
"no" at step 6 ends with exit 0 and nothing written.

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
by tokens. `ork usage` adds the runs up like any others.

## Proposing, picking, writing

- **Propose** (`ork:onboard-propose`): an agent with reading tools only (`Read`,
  `Grep`, `Glob`) and no shell reads your repository and may ask you up to three
  follow-up questions. For each workflow it gives why, where a person decides,
  its caps, evidence (a file or a commit) and, optionally, the commands it would
  run.
- **Filter:** Ork drops a suggestion that cites a file or commit that does not
  exist, or drafts a command whose program is not on your `PATH` or whose
  package script is not in your `package.json`. Nothing the agent drafted runs.
- **Pick:** the survivors are listed with their evidence; a pick-several prompt
  takes any number (Space toggles, Enter confirms, or `1,3` with `--plain`).
  Picking none ends cleanly with nothing written.
- **Write** (`ork:onboard-write`): a writer with no shell works in its own
  worktree. Ork then checks its work (below) and sends problems back to the
  writer, up to 3 rounds. Out of rounds, the run ends failed and the command
  prints the problems and the run id (`ork resume <run>` resumes that run).

Every written workflow carries a dollar and a token cap, names no `driver` or
`model` (the machine running it picks), and uses only the built-in
`ork-implementer` and `ork-reviewer` agents; it writes no `.ork/agents/` file.

## The gate

The gate shows the diff stat and a **needs your eye** list: every new
`tools.allow` rule, every new `env` entry on a tool node, and every network
reach (`tool.gh`, `tool.aws`, `mcp.call`, an `mcp:` server, `WebFetch`,
`WebSearch`). A written permission is a visible choice.

- **keep** leaves the branch and prints its name and "Ork never merges". Review
  it like any branch and merge it yourself. A kept change lists the feedback
  items its suggestions cited; none is marked resolved.
- **discard** removes the run's worktree and branch. A branch with no commits is
  treated as nothing to keep.

Nothing in your working tree's `.ork/` changes before you keep: the writer works
only in its worktree.

## What is checked, and what is only asked for

Checked in code, not by a prompt:

- Evidence, drafted commands and workflow names (the filter).
- That the writer changed only `.ork/workflows/*.ork.yaml` and
  `.ork/project.yaml`, that each workflow has both caps, names no `driver` or
  `model`, uses only the two built-in agents, is in Ork's canonical form, and
  passes `ork validate` and `ork validate --driver <id>` for every driver ready
  on the machine.

Held only by a prompt:

- How many follow-up questions the proposer asks (a turn limit bounds it too).
- How good the proposals and the written workflows are: Ork checks form, not
  judgment. Read the diff.
- **The writer is held to `.ork/` by a check on its worktree, not a sandbox.** A
  write outside the worktree is not seen ([G14](../../specs/gaps.md)).
- The proposer's reads stay in your project by its prompt alone on `claude-code`
  and `command-code`; what it reads goes to the model provider.

## What each driver loads

Both built-in workflows ask a session to ignore your project's own instructions
and skills, since your repository is data here. Only `claude-code` applies it:

| Driver         | Your project's instructions and skills in these sessions                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code`  | Off. `CLAUDE.md`, `.claude/rules` and `AGENTS.md` stay out and skills are off. `.claude/settings.json` still loads, hooks included.                     |
| `open-code`    | Not off: the repository's `AGENTS.md` loads. `.claude/` and `CLAUDE.md` stay out, as always.                                                            |
| `command-code` | Not off: `AGENTS.md`, `.commandcode/skills` and `.commandcode/agents` load, and so do your own skills, memory and mods. The most it reads of the three. |

Nothing warns about this. If the repository is one you don't trust, use
`claude-code`; the limits are listed in the
[gaps](../../specs/gaps/onboard-limits.md). More on what sessions load:
[Drivers](./drivers.md#what-the-onboarding-sessions-read).

## Credentials

Ork never asks for, stores or sends a credential. The survey records only
whether `gh` is usable. Each driver uses its own login.

## Limits

- An attached project is refused.
- An interrupted flow starts over; `ork resume <run>` resumes one of its two
  runs, not the steps between them.
- Onboarding is not in `ork ui` or the MCP server.

Details: [the spec](../../specs/cli/onboard.md).
