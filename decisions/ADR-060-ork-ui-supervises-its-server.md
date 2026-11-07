# ADR-060 — `ork ui` supervises its server, so the page can restart it onto a new install

- **Status:** Accepted
- **Date:** 2026-11-07
- **Topic:** CLI / server / distribution
- **RFC:** waived — the maintainer chose among the options below directly, while
  planning the UI's new-version banner and upgrade
- **Builds on:** [ADR-038](./ADR-038-update-notice-and-upgrade.md) (the daily
  check and `ork upgrade`), [ADR-039](./ADR-039-local-server.md) (the local
  server and `ork ui`)

## Context

ADR-038 put the update check, the record and the installers in the core so the
UI could offer the same upgrade as `ork upgrade`. Building it raised two things
ADR-038 left open. After the package manager has replaced Ork's files, the
running `ork ui` still runs the old version, and its page can't be trusted to
match the new install: someone has to stop it and start the new one, on the same
port and with the same sign-in, or the open tab is lost. And `ork ui` can run
for days, but only a command starting starts the daily check, so a long-running
UI would learn of a version only when some other command ran.

`ork ui` ran its server in the terminal's own process; nothing could replace it
from inside without leaving the terminal behind.

## Decision

1. **`ork ui` is a supervisor, always.** The process in the terminal starts the
   server as its one child, the launcher the user ran (`process.argv[1]` as
   given, not its real path, since a pnpm or Volta upgrade can remove the old
   real path while the launcher now points at the new install) with
   `ui --serve`, on the same Node, with the terminal's stdio. It checks for a
   running `ork ui` (`~/.ork/ui.json`) and prints the address and the sign-in
   link as before; the child writes `ui.json` with its own pid.
2. **The port and the token go over the child's IPC channel,** never in argv
   (where `ps` shows them) nor in the environment (which the runs the server
   starts would inherit). The child says hello, the supervisor sends
   `{ port, token }`, the child says it is ready with the port it bound and its
   version. A restart reuses the bound port (so `--port 0` comes back where it
   was) and the same token (so the open tab's cookie still signs it in). The
   messages only ever gain optional fields, since an older supervisor starts a
   newer child after an upgrade.
3. **Restart is the page's, after a confirm.** `POST /api/restart` answers 202
   with the port and the old pid, then the child tells the supervisor it is
   restarting, closes its streams and its listener, and exits; the supervisor
   starts the launcher again. The page waits on `/api/health` for a new pid on
   the upgraded version, then reloads. There is only ever one child, so restarts
   don't stack processes. The server refuses a restart while an upgrade runs,
   and one it can't do (a server not started by `ork ui`).
4. **Signals.** Ctrl-C reaches both processes from the terminal; the supervisor
   also passes SIGINT and SIGTERM to its child, waits for it, and exits with its
   code. A child whose supervisor is gone (its channel closes) closes and exits,
   so no server is left behind. A child that fails to start again is reported on
   the terminal with the command to start it by hand, and the supervisor exits
   with its code; the page says the same after a minute.
5. **The server runs the daily check itself,** when it starts and then asking
   hourly whether one is due, through the same record, so the machine still asks
   the registry at most once a day whoever asks; under the same switches
   (`ORK_NO_UPDATE_CHECK`, `NO_UPDATE_NOTIFIER`, `CI`). It re-reads the record
   once a minute and sends what it knows on the overview stream, so the banner
   appears without a reload. The `ui --serve` child starts no detached check of
   its own.

## Options considered

- **The old server spawns the new one as its child and waits:** no change to
  `ork ui`'s process, but each restart nests another old process, and Ctrl-C has
  to travel down the chain.
- **The old server spawns the new one detached and exits:** no process left
  over, but the terminal gets its prompt back and nothing on it can stop the
  server any more, which breaks `ork ui`'s Ctrl-C.
- **No restart; say "restart `ork ui`" instead:** the simplest, but the open tab
  is lost to a new token, and a person in the browser has to find the terminal.
- **The token in an environment variable for the child:** private from `ps`, but
  the child would have to remember to drop it before starting runs, or every
  agent would inherit a way into the UI.
- **Only commands start the check (ADR-038 as it was):** no new place that asks
  the network, but a UI open for days shows nothing new until some command runs
  in a terminal.

## Rationale

A supervisor is the one shape in which the terminal keeps its process, its
Ctrl-C and its output across a restart, and the restart can start a different
`ork` than the one running. The IPC channel already exists between a Node parent
and child and is private to the two. Running the check in the server adds no
request beyond ADR-038's once a day, only a second place that may make it, under
the same switches.

## Consequences

- `ork ui` is two processes: `ps` shows the supervisor and its `ork ui --serve`;
  `ui.json` names the child. `ork ui --serve` run by hand refuses and says to
  run `ork ui`.
- The restart protocol is a contract between versions: an older supervisor
  starts a newer `ui --serve`, so its messages may only grow.
- A long-running `ork ui` may be the one that asks the registry on a given day;
  the installation guide says so, and how to turn it off.
- What a restart can't fix (another `ork` first on the PATH, a token that didn't
  carry over) the page says in words, with the command to run.
- `process.argv[1]` is the path Node was given, not the real path. It stays the
  same across an upgrade for npm (its bin link), pnpm (whose shim runs the
  package through `global/5/node_modules`, or from pnpm 11 through a
  `global/v11/<hash>` link swapped onto each new install, the hash being the
  package names and registries) and Volta 1.1 or later
  (`tools/image/packages/<name>`, replaced in place). A pnpm global install
  whose registry settings changed in between gets a new hash and path; the
  restart then fails as above and says to run `ork ui`.
