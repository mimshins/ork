# Limits: upgrading from the browser view

_Part of [Known gaps and limits](../gaps.md)._

What the new-version banner and the Upgrade dialog do for now, by choice
([updates](../cli/updates.md#in-ork-ui),
[ADR-060](../../decisions/ADR-060-ork-ui-supervises-its-server.md)).

- **L159 · Only the latest, and no stopping it.** The dialog upgrades to the
  registry's `latest`, as `ork upgrade` does; another version, or going back,
  takes the package manager in a terminal. A running package manager can't be
  stopped from the page: it gets no standard input, so it ends on its own.
- **L160 · No Restart after advice.** A clone or an `npx` copy gets the steps to
  run, as `ork upgrade` gives them; after running them, the person restarts
  `ork ui` themselves, and an open tab's "page is older" banner reloads it.
- **L161 · The upgrade is remembered for the server's life.** A reload or a
  second tab finds the running or ended upgrade and its last 2,000 lines of
  output; a restart, or Ctrl-C, forgets them.
- **L163 · Dismiss's tooltip is its name.** An icon button's tooltip is its
  label, so it reads "Dismiss for a day" rather than also saying that a newer
  version shows the banner again.
- **L164 · A restart starts what the launcher now is.** `ork ui` starts the path
  it was run as with its own Node binary. An install that doesn't know
  `ork ui --serve` (an older version, after a downgrade) can't serve; the
  terminal says so with `ork ui --port <n>`, and the page that it didn't come
  back. Windows' `.cmd` package managers still can't be started
  ([L9](./limits.md)).
- **L167 · A registry URL with a user name and password can't be asked.** Node's
  `fetch` refuses a URL that carries credentials, so an `ORK_UPDATE_REGISTRY` of
  `https://user:token@mirror…` reads as unreachable; the page shows it without
  them. A mirror that needs signing in would take a header from the user's own
  npm config, which Ork doesn't read.
- **L168 · Ctrl-C reaches the package manager too.** It runs in the terminal's
  process group, so a Ctrl-C that stops `ork ui` mid-upgrade reaches it as well,
  and what it does then is its own; `ork ui` reads its output until it exits,
  then stops. SIGTERM, or the supervisor going, leaves it to finish. A second
  Ctrl-C stops `ork ui` at once and may leave the install half-done;
  `ork upgrade` in a terminal finishes it.
