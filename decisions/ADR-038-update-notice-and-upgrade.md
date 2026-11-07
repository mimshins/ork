# ADR-038 — A daily new-version notice, and `ork upgrade` that asks first

- **Status:** Accepted; amended by
  [ADR-061](./ADR-061-release-channels-toward-1-0.md)
- **Date:** 2026-11-02
- **Topic:** CLI / distribution / network
- **RFC:** waived — the author chose these options over the others below
- **Builds on:** [ADR-015](./ADR-015-changesets-and-one-bundled-cli.md) (one
  bundled CLI on npm); RFC-002, rejected
  ([archived](../rfcs/archived/RFC-002-standalone-binaries-and-installer.md)),
  which had proposed an `ork upgrade` for standalone binaries

## Context

`@krapht/ork` 0.1.0 is on npm, and Ork is pre-alpha: releases will come often,
and users on an old version miss fixes and hit formats that have changed.
Nothing told them a new version was out. Until now Ork never contacted a server
of its own: every network request was made by the user's own tools (`claude`,
`gh`, `aws`, `git`).

How `ork ui` offers this upgrade, restarts itself onto the new install, and runs
the daily check while it stays open is
[ADR-060](./ADR-060-ork-ui-supervises-its-server.md).

## Decision

1. **A daily background check.** At most once a day, a command starts a detached
   copy of `ork` that asks the npm registry for the package's `latest` dist-tag
   (`GET /-/package/@krapht/ork/dist-tags`, an 18-byte answer) and records it in
   `~/.ork/update-check.json`. No command waits on the network; a failed check
   is recorded too, and retried a day later.
2. **One line, once a day.** When the record knows a newer version, a later
   command ends with one line on stderr: the new version, the current one, and
   `ork upgrade`. The same version is not announced again for a day.
3. **Off where it does not belong.** No check and no notice in CI (`CI` set),
   without a terminal on stderr, in a detached run, with `--json`, or with
   `ORK_NO_UPDATE_CHECK=1` or the common `NO_UPDATE_NOTIFIER=1`.
   `ORK_UPDATE_REGISTRY` points the check at a mirror.
4. **`ork upgrade` asks the registry now** and, when a newer version is out,
   upgrades Ork the way it was installed: it recognises the install from the
   running script's real path, through a registry of installers (npm, pnpm,
   yarn, bun, Volta global installs, each with its command; a clone or `npx`,
   each with advice), shows the command and runs it only after the user agrees
   (`--yes` skips the question; without a terminal it prints the command
   instead). `--check` only reports. It warns about runs still running.
5. **`ork doctor` shows the version** against the last check, without asking the
   network.
6. **The UI reuses it.** The check, the record and the installers live in
   `@krapht/ork-core`, so M2's server and UI read the same record and offer the
   same upgrade.

## Options considered

- **Check only when asked** (`ork upgrade --check`, `ork doctor`): no automatic
  request at all, but users rarely find out. Rejected by the author.
- **A daily check, off until turned on:** private by default, but most users
  would never turn it on. Rejected by the author.
- **Check in the foreground on every command:** simpler, but every command would
  wait on the network, and offline machines would stall.
- **`ork upgrade` that only prints the command:** Ork would change nothing
  itself, but the user would have to know which package manager installed it.
  Rejected by the author in favour of running it after asking.
- **The `update-notifier` package:** a new runtime dependency with its own
  dependencies, for what is a small module; and it could not offer the upgrade.

## Rationale

A notice is how a pre-alpha tool keeps its users on fixed versions. Running the
check in a detached process, once a day, keeps every command as fast and as
offline-tolerant as before; the request carries nothing about the user, their
projects or their runs, only what any `npm view` sends. Upgrading through the
package manager that installed Ork keeps one copy on the machine, and asking
first keeps Ork from changing the user's machine on its own.

## Consequences

- Ork makes its first request of its own: to the npm registry, at most once a
  day, unless turned off. The installation guide says so and how to turn it off.
- The record's file is shared by the CLI and, later, the UI.
- An install the path does not reveal gets the npm command as advice; a mirror
  set only in `.npmrc` is not read ([L23, L24](../specs/projects/limits.md)).
- On native Windows, package managers are `.cmd` files that Ork's shell-less
  spawn cannot start; Windows is supported through WSL (L9).
