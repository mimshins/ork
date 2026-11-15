# Next release

_Part of [What's new](../whats-new.md)._

- **Short flags mean the same everywhere.** Nine flags have a one-letter form on
  every command that has them: `-a --all`, `-d --detach`, `-f --follow`,
  `-i --input`, `-m --message`, `-n --limit`, `-o --output`, `-p --project` and
  `-y --yes`. So `ork decide -f`, `ork ps -p all -n 5` and
  `ork run plan -d -i brief="…"` now work, and `--help` shows each letter. The
  help showed `ork decide`'s `--watch` as `-watch`, which never worked; it now
  says "also --watch" ([short flags](../guides/tab-completion.md#short-flags)).
- **A question's options read by their label.** The arrow-key list showed an
  option as `allow Allow`; it now shows `Allow (allow)`, with the id that
  `ork decide --choose` takes dimmed, and plain output prints `1) Allow (allow)`
  ([the terminal](../guides/terminal.md#questions)).
