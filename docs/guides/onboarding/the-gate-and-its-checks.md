# The gate, what is checked, and the limits

_Part of [Onboarding: `ork onboard`](../onboarding.md)._

## The gate

The gate shows the diff stat and a **needs your eye** list. It names only what
writes, runs or reaches the network: every new `tools.allow` rule, every new
`env` entry on a tool node, and every network reach (`tool.gh`, `tool.aws`,
`mcp.call`, an `mcp:` server, `WebFetch`, `WebSearch`). A plain read (`Read`,
`Glob`, `Grep`, `LS`, `NotebookRead`) is not listed; any other tool name is,
`Bash(…)` rules included, and so is a rule Ork cannot read. A written permission
is a visible choice.

It also lists a change, against what is committed, to a setting that widens what
a run reads, shares or does: on a node `context`, `isolation` and `tools.only`;
in a workflow `context`, `rules.git`, `rules.links` and `defaults.isolation`;
and in `.ork/project.yaml` `context`, `heavy`, `calls.accept`, `followUps.file`,
`git`, `links` and `defaults.isolation`. Each reads
`<where> changes <field> to <value>`; a field the committed file set and the
writer removed reads `<where> removes <field>`. A node the writer deleted gives
one line, `node <id> removed`, in place of a line per field.

- **keep** leaves the branch and prints its name and "Ork never merges". Review
  it like any branch and merge it yourself. A kept change lists the feedback
  items its suggestions cited; none is marked resolved.
- If your `.ork/project.yaml` sets `commit: never`, the writer has no branch:
  its change is uncommitted in its worktree, and **keep** copies it into your
  checkout as uncommitted files for you to commit. If those files clash with
  changes you have there, nothing is copied and the worktree's path is printed.
- In a project attached with `ork register`, the writer has no branch either,
  and **keep** puts the files in Ork's own folder for the project
  (`~/.ork/projects/<id>/workflows/`), never in your repository. It prints
  `kept the workflows in <folder>: <files>` and that nothing is in the
  repository. If a file it would write changed in that folder since the writer
  started, nothing is written, the worktree's path is printed and the command
  exits 1: run `ork onboard` again.
- **discard** removes the run's worktree and branch. A branch with no commits,
  or a worktree with no change, is treated as nothing to keep. In an attached
  project Ork's folder is untouched.

Nothing in your working tree's `.ork/` changes before you keep: the writer works
only in its worktree.

## What is checked, and what is only asked for

Checked in code, not by a prompt:

- Evidence, drafted commands and workflow names (the filter).
- That the writer changed only `.ork/workflows/*.ork.yaml` and
  `.ork/project.yaml` (a file it left in an ignored path counts, unless it is an
  unchanged copy Ork put there, byte-identical to the project root's, or the
  empty `.commandcode/taste/taste.md` Command Code makes in its folder, at the
  repository's top for a project in a subfolder), that each workflow has both
  caps, names no `driver` or `model`, uses only the two built-in agents (a
  workflow you already had keeps the driver, model and agents it names; only new
  ones count), is in Ork's canonical form, and passes `ork validate` and
  `ork validate --driver <id>` for every driver ready on the machine.

Held only by a prompt:

- How many follow-up questions the proposer asks (a turn limit bounds it too).
- How good the proposals and the written workflows are: Ork checks form, not
  judgment. Read the diff.
- **The writer is held to `.ork/` by a check on its worktree, not a sandbox.** A
  write outside the worktree is not seen ([G14](../../../specs/gaps.md)).
- The proposer's reads stay in your project by its prompt alone on `claude-code`
  and `command-code`; what it reads goes to the model provider.

## What each driver loads

Both built-in workflows ask a session to ignore your project's own instructions
and skills, since your repository is data here. Only `claude-code` applies it.
`codex` and `omp` don't run these workflows at all: they can't hold the turn
limit the workflows set, so the run is refused before any session starts
([Onboarding](../onboarding.md)).

| Driver         | Your project's instructions and skills in these sessions                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code`  | Off. `CLAUDE.md`, `.claude/rules` and `AGENTS.md` stay out and skills are off. `.claude/settings.json` still loads, hooks included.                     |
| `open-code`    | Not off: the repository's `AGENTS.md` loads. `.claude/` and `CLAUDE.md` stay out, as always.                                                            |
| `command-code` | Not off: `AGENTS.md`, `.commandcode/skills` and `.commandcode/agents` load, and so do your own skills, memory and mods. The most it reads of the three. |

Nothing warns about this. If the repository is one you don't trust, use
`claude-code`; the limits are listed in the
[gaps](../../../specs/gaps/onboard-limits.md). More on what sessions load:
[Drivers](../drivers.md#what-the-onboarding-sessions-read).

## Credentials

Ork never asks for, stores or sends a credential. The survey records only
whether `gh` is usable. Each driver uses its own login.

## Limits

- In an attached project the writer sees your last commit, not uncommitted
  files, and it is given your current workflows and rules from Ork's folder. A
  copy of those rules sits as a stray commit object in your repository's `.git`
  until `git gc`; nothing is pushed.
- A crash inside the survey or the three questions starts over. A proposal you
  left at the pick, and a proposing run that failed, stopped or crashed, are not
  lost: the next `ork onboard` offers them.
- Onboarding is not in `ork ui` or the MCP server.

Details: [the spec](../../../specs/cli/onboard.md).
