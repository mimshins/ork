# Limits found keeping Ork's sessions apart from a project's own agent process

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building the agent isolation, the `knowledge` rule, the write limit, the
`quiet` practice and the attached context mapping
([ADR-110](../../decisions/ADR-110-keep-ork-sessions-apart.md),
[rules](../project-rules/agents-and-knowledge.md),
[the write limit](../runtime/write-limit.md),
[context](../context/session-apart.md)). What was left simpler, or could not be
checked:

- **L516 · `rules.agents: isolate` matches by name only.** The deny is
  `Agent(<name>)` for the workflow's agent keys. A repository agent file whose
  `name:` differs from the key the workflow uses for it is not denied, and an
  agent no node names is never denied.
- **L517 · Isolation probably holds only on `claude-code`.** The `Agent(<name>)`
  and `Task(<name>)` entries go into every driver's deny list, but `codex`,
  `command-code` and `omp` have no sub-agent tool of Claude Code's kind, and the
  shared matcher reads a specifier it does not know as "never allow": whether
  those drivers act on the entries at all was not checked on a real session.
  `open-code` was not checked either.
- **L518 · `open-code` cannot hold the write limit.** Its permission rules match
  a path as written, not where its links lead, so a `writeOnly` session is
  refused to start (`OPEN_CODE_NO_WRITE_LIMIT`), and `ork feedback apply` under
  `knowledge: ork-only` cannot run on it. Run it on another driver.
- **L519 · The write limit covers the edit tools, not the shell.** `Write`,
  `Edit`, `MultiEdit` and `NotebookEdit` are checked; a `Bash` call that writes
  a file is not. The feedback worker has no shell (`tools.only`), which is what
  holds it, so a workflow that sets `writeOnly` through another path and gives
  the node a shell is not limited.
- **L520 · The write limit is not carried everywhere.** It reaches the nodes of
  the run `ork feedback apply` starts, and an `ork resume` of that run (recorded
  in `run.started`'s settings). A nested `workflow.call` run and the session an
  owner asks a question through start without it. `ork feedback apply`'s
  workflow has neither today.
- **L521 · `ork feedback apply` is refused for an attached project that sets
  `knowledge: ork-only`.** Its Ork folder is under `~/.ork/projects/<id>/`,
  outside the repository, and editing it in place from the worker's worktree is
  not built, so the maintainer makes the change by hand. Building it would add
  an engine path for a worktree that does not hold the folder.
- **L522 · `ork link` does not warn about linking, and no `.ork/README.md` tells
  outside agents what the folder is.** `ork init` and `ork migrate --agents` say
  that linked tool folders and `.ork/skills` reach every contributor's own agent
  tool; `ork link` creates the same links without it. A short README scaffolded
  by `ork init`, saying `.ork/` is Ork's configuration and not instructions for
  agents outside Ork, would reach agents that search the repository. Neither is
  built; the `--link` and `--skills` defaults are unchanged.
- **L523 · A mapped context file keeps its `.ork/…` name, and a watch list still
  points at `<root>/.ork/`.** In an attached project a reference such as
  `.ork/context/a.md` is read from `~/.ork/projects/<id>/context/a.md`, and
  `ork context explain` shows it under the `.ork/…` name it was written with,
  not the file it read. Anything that watches the reference's path for a change
  (explain's watch list) still looks at `<root>/.ork/`, where the attached file
  is not, so an edit to it is not noticed there. Not checked end to end: no such
  list was found in the code read for this change.
