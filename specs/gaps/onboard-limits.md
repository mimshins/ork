# Limits found building `ork onboard`

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found planning and building [`ork onboard`](../cli/onboard.md)
([RFC-018](../../rfcs/archived/RFC-018-onboard.md)). What was left simpler, or
could not be checked:

- **L390 · An attached project is refused.** `ork onboard` stops in a project
  `ork register` attached and names `ork init`, since its writer works on a
  branch of the repository and attached workflows live outside it. Supporting
  them needs another way to write into the attached folder and show the diff.
- **L391 · An interrupted onboard starts over.** What the command holds between
  its two built-in runs (the survey, the answers, the picks) lives only in the
  process. `ork resume <run>` resumes one built-in run; the command's own steps
  around it start again from the survey.
- **L392 · The follow-up question cap is a prompt.** `ork:onboard-propose`'s
  prompt asks for at most three `ask_user` questions, and `maxTurns` bounds it;
  the format has no field that counts a node's questions.
- **L393 · `layers.project: ignore` does nothing on `open-code` and
  `command-code`.** Only the Claude Code driver passes the session settings that
  carry it, so the repository's `AGENTS.md` (both) and Command Code's
  `.commandcode/skills` and `.commandcode/agents` load, and nothing warns:
  `ork validate --driver` has no capability for it. Command Code also loads the
  machine's own skills, memory and mods
  ([what a session loads](../runtime/what-a-session-loads.md)).
- **L394 · Ignoring the project layer leaves Claude Code's project settings
  on.** `.claude/settings.json` and `settings.local.json` still load (the
  session's `settingSources` stay `[project, local]`, which is what
  `--setting-sources project,local` passes), with their permissions and hooks,
  so a cloned project's hook runs in an onboarding session as in any run.
- **L395 · The writer is held to `.ork/` by a check, not a sandbox.** `finish`
  refuses a change outside `.ork/workflows/*.ork.yaml` and `.ork/project.yaml`
  that lands in the writer's worktree; a bare `Edit` or `Write` allow is not
  held to the worktree (G14), so a write elsewhere is not seen. The gate says
  so.
- **L396 · Cited feedback ids are not checked.** A suggestion's `feedback` ids
  pass `filter` unchecked and are only listed when kept; none is resolved.
- **L397 · `ork init`'s `.gitignore` edit stays outside the branch.** When
  `ork onboard` sets `.ork/` up, the `.gitignore` entry is left uncommitted in
  the working tree, and the closing text says to commit it with the branch.
- **L398 · A suggestion can't be declared field by field.** An agent's list item
  holds only scalars (L358), so the proposer reports `{ list: {} }` and only
  `filter` holds each item to `SuggestionSchema`; the driver sees no item shape.
- **L399 · The proposer's reads are not held to the project.**
  `ork:onboard-propose` allows `Read`, `Grep` and `Glob` by bare name, since
  OpenCode refuses `grep` and `glob` unless allowed (L236). On `claude-code` and
  `command-code` a bare allow also covers paths outside the checkout (`~/.ssh`,
  `~/.aws`), so the proposer can read them with no prompt, and what it reads
  reaches the model provider. Only its prompt keeps it to the project; OpenCode
  still refuses a path outside the worktree. The same class as G14 for the
  writer's `Edit` and `Write`.
- **L400 · A first visit warns of uncommitted files.** The `.ork/` that
  `ork onboard` sets up, and its `.gitignore` edit, are uncommitted, so each of
  the two runs prints
  `warning N uncommitted change(s) in this checkout are not in the worktrees`.
  It is harmless, since the writer only adds files, but it reads as a problem.
  Committing the set-up first, or leaving it out of the warning, would close it.
- **L401 · `filter` skips a package script behind a flag.** A drafted line whose
  first word after the manager is a flag (`pnpm -r nope`, `npm --silent run x`)
  is not checked against `package.json`'s scripts, since `filter` cannot tell
  the flag's value from the script name; its program is still checked. Parsing
  each manager's flags would close it.
- **L402 · `.ork/project.yaml` may set a `driver` or `model` for every
  workflow.** `defaults.driver` and `defaults.model` there apply to every
  workflow, so the rule that written workflows name neither also holds for the
  project file. `finish` checks the workflow files for it and only lists the
  project file's `defaults` at the gate, so a `driver` or `model` there is
  shown, not refused. Refusing it in `finish` would close it.
