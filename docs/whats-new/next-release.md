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
