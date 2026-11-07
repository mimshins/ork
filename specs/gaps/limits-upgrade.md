# Limits: upgrading from the browser view

_Part of [Known gaps and limits](../gaps.md)._

What the new-version banner and the Upgrade dialog do for now, by choice
([updates](../cli/updates.md#in-ork-ui),
[ADR-060](../../decisions/ADR-060-ork-ui-supervises-its-server.md)).

- **L155 · Only the latest, and no stopping it.** The dialog upgrades to the
  registry's `latest`, as `ork upgrade` does; another version, or going back,
  takes the package manager in a terminal. A running package manager can't be
  stopped from the page: it gets no standard input, so it ends on its own.
- **L156 · No Restart after advice.** A clone or an `npx` copy gets the steps to
  run, as `ork upgrade` gives them; after running them, the person restarts
  `ork ui` themselves, and an open tab's "page is older" banner reloads it.
- **L157 · The upgrade is remembered for the server's life.** A reload or a
  second tab finds the running or ended upgrade and its last 2,000 lines of
  output; a restart, or Ctrl-C, forgets them.
- **L158 · Advice is the CLI's sentence.** The plan's advice is `ork upgrade`'s
  text as it is, so the commands in it aren't set apart as code in the dialog.
- **L159 · Dismiss's tooltip is its name.** An icon button's tooltip is its
  label, so it reads "Dismiss for a day" rather than also saying that a newer
  version shows the banner again.
- **L160 · A restart starts what the launcher now is.** `ork ui` starts the path
  it was run as with its own Node binary. An install that doesn't know
  `ork ui --serve` (an older version, after a downgrade) can't serve; the
  terminal says so with `ork ui --port <n>`, and the page that it didn't come
  back. Windows' `.cmd` package managers still can't be started
  ([L9](./limits.md)).
