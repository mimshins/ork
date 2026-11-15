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
