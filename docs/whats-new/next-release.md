# Next release

_Part of [What's new](../whats-new.md)._

- **Short flags mean the same everywhere.** Nine flags have a one-letter form on
  every command that has them: `-a --all`, `-d --detach`, `-f --follow`,
  `-i --input`, `-m --message`, `-n --limit`, `-o --output`, `-p --project` and
  `-y --yes`. So `ork decide -f`, `ork ps -p all -n 5` and
  `ork run plan -d -i brief="…"` now work, and `--help` shows each letter. The
  help showed `ork decide`'s `--watch` as `-watch`, which never worked; it now
  says "also --watch" ([short flags](../guides/tab-completion.md#short-flags)).
- **Questions are easier to spot and read.** A question's card, and a permission
  prompt, now has a bright green bar down its left edge and a green `ASK` chip,
  so it stands out among a run's output. An option shows its label first and its
  id dimmed in parentheses (`Allow (allow)`, where it read `allow Allow`); plain
  output prints `1) Allow (allow)`
  ([the terminal](../guides/terminal.md#questions)).
- **Run with no permission prompts.** `ork run --yolo` (and `ork resume --yolo`)
  lets one run go without asking about any tool: everything a node's `deny` list
  doesn't refuse is allowed, on every driver. Ork warns and asks once (`--yes`
  agrees without the question, and is needed with no terminal); the runs it
  calls are yolo too, a resume needs `--yolo` again, and `ork ps`, `ork tree`,
  the run's first line and `ork ui` say so while it runs. Questions, gates and
  budgets still stop it
  ([guide](../guides/running-workflows/running-and-answering.md#with-no-permission-prompts---yolo)).
- **Fixes from the alpha.20 QA pass.** `ork logs -f --all --workflow <name>`
  follows only that workflow's live runs and the runs they call, as the guide
  said (the flag was refused). The Runs panel of `ork ui` keeps the last filter
  that worked after you maximize or restore it, where it showed every run
  `ork tree` names who holds the check slot a node waits for, and when the
  `issues` workflow builds no issue, its failed step names every issue and why,
  where it showed only the last
  ([looking back](../guides/running-workflows/looking-back.md#follow-every-live-run),
  [filtering lists](../guides/filtering-lists.md),
  [issues](../guides/issues-in-parallel/running-it.md)).
- **Clearer driver choice, and runs started inside a detached run detach.** When
  `claude-code` isn't ready and several other drivers are, `ork run` and
  `ork init` now say `claude-code isn't ready, so open-code is next`, where they
  read as if open-code came first. An `ork run --detach` started by a node of a
  detached run goes to the background again, and no longer says "detached run"
  when run in the foreground there ([drivers](../guides/drivers.md)).
- **Smaller fixes from the QA pass.** zsh's completion menu no longer ends a
  list of plain values (`ork ps --status `) with a stray `--`.
  `ork logs -f --all` piped to `head` ends quietly, and so does every command
  whose reader closes early. `ork decide`'s plain prompt takes `q`, or the end
  of its input, as "later", where it crashed. `ork logs` refuses `--calls` with
  `--no-calls`. `ork follow-ups show a,b` says it takes one id, and `due` with
  an unknown id says there's no such follow-up. `ork ui` says so when the UI it
  found doesn't answer (not that it is "older"), and exits 1 when it prints no
  link. The guides now say a called run's lines sit under its call node's id
  (`plan › `), not `call › `. Upgrade: if you saved the zsh completion script to
  a file, run `ork completion zsh` into it again
  ([tab completion](../guides/tab-completion.md)).
- **`ork ui` and crashed runs, from the same QA pass.** A filter field's hint no
  longer covers the next field while you type in it. The Decisions filter shows
  an unknown run as a refused value, keeping the last command that worked. The
  Logs panel shows Follow on only for a live run, and its command has no
  `--follow` for an ended one. `ork logs` of a crashed run ends with
  `run <id> crashed: its process is gone`, as `ork logs -f` and `ork attach` now
  say too ([looking back](../guides/running-workflows/looking-back.md)).
