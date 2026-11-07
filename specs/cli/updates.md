# Updates

_Part of [The ork CLI](../cli.md)._

Status: **Built**, in the CLI
([notice](../../packages/cli/src/update/notify.ts),
[upgrade](../../packages/cli/src/commands/install.ts),
[tests](../../packages/cli/test/upgrade.test.ts)) and in `ork ui`, whose notice
is a banner and whose upgrade is a dialog with a restart
([server](../../packages/server/src/updates.ts),
[routes](../../packages/server/src/update-routes.ts),
[supervisor](../../packages/cli/src/browser/supervise.ts),
[banner](../../packages/ui/src/workspace/update-banner.tsx),
[dialog](../../packages/ui/src/workspace/upgrade-dialog.tsx),
[server tests](../../packages/server/test/upgrade.test.ts),
[UI tests](../../packages/ui/test/workspace/upgrade-dialog.test.tsx)). Both
share the core's check, record, installers and plan
([check](../../packages/core/src/update/check.ts),
[installers](../../packages/core/src/update/installers.ts),
[plan](../../packages/core/src/update/plan.ts),
[core tests](../../packages/core/test/update.test.ts)). Decided in
[ADR-038](../../decisions/ADR-038-update-notice-and-upgrade.md) and, for
`ork ui`, [ADR-060](../../decisions/ADR-060-ork-ui-supervises-its-server.md).

## The new-version notice

- **The check.** When a command starts and the last attempt is a day old (or
  there is none), it records the attempt and starts a detached copy of `ork`
  with `ORK_UPDATE_CHECK_CHILD=1`. That copy asks the registry for
  `/-/package/@krapht/ork/dist-tags`, with a 5-second timeout, and writes
  `~/.ork/update-check.json`: `checkedAt`, `latest` (kept from before when the
  request fails), and `notified`. The command itself never waits.
- **The notice.** When the command exits and the record's `latest` is newer than
  the running version by semver precedence, it writes one line to stderr:
  `Ork <latest> is out (you have <current>). Upgrade with: ork upgrade`, and
  records `notified`. The same version is announced at most once a day.
- **Off** when `ORK_NO_UPDATE_CHECK` or `NO_UPDATE_NOTIFIER` is set (to anything
  but empty, `0` or `false`), when `CI` is set, in a detached run, when stderr
  is not a terminal, with `--json`, and for `ork upgrade`.
- **Registry:** `https://registry.npmjs.org`, or `ORK_UPDATE_REGISTRY`.
- `ork doctor`'s first line is Ork's version against the record: a warning with
  `ork upgrade` when a newer one is known, otherwise the date of the last check
  (or that none ran, or that the check is off). Doctor makes no request.

## ork upgrade

```
ork upgrade [--check] [--yes]
```

1. Asks the registry now (15-second timeout) and records the answer; when it
   cannot, it says so and exits 1.
2. When the latest version is not newer, it says this one is the latest and
   exits 0. Otherwise it prints both versions and the release notes' link; with
   `--check` it stops there, exit 0.
3. It finds how Ork was installed from the running script's real path, in the
   installer registry, first match wins:

   | Installer | Recognised by                       | Does                                                          |
   | --------- | ----------------------------------- | ------------------------------------------------------------- |
   | `source`  | `/packages/cli/`, no `node_modules` | advice: `git pull`, `pnpm install`, `pnpm build` in the clone |
   | `npx`     | `/_npx/`                            | advice: `npx @krapht/ork@<v>`, or a global install            |
   | `pnpm`    | `/pnpm/global/`, `/.pnpm-global/`   | `pnpm add --global @krapht/ork@<v>`                           |
   | `yarn`    | `/yarn/global/`                     | `yarn global add @krapht/ork@<v>`                             |
   | `bun`     | `/.bun/install/global/`             | `bun add --global @krapht/ork@<v>`                            |
   | `volta`   | `/.volta/tools/`                    | `volta install @krapht/ork@<v>`                               |
   | `npm`     | `/node_modules/`                    | `npm install --global @krapht/ork@<v>`                        |

   Advice, or no match (advice with the npm command), exits 1 with nothing run.

4. It lists runs still running on the machine: their next sessions would start
   from the new install.
5. It shows the command and runs it on the terminal after the user answers yes;
   `--yes` skips the question; without a terminal on stdin and without `--yes`
   it prints the command and exits 1. The command's exit code is
   `ork upgrade`'s.

## In ork ui

- **The record, live.** The server reads `~/.ork/update-check.json` at most once
  a minute. `GET /api/version` and the overview stream's `version` event give
  the running version, the record's `latest`, a `newer` version when one is
  known, its release notes, whether the check is off and why, the registry when
  `ORK_UPDATE_REGISTRY` names one, and the server's upgrade, if any. The banner
  reads it ([the banner](../ui/workspace.md#the-new-version-banner)); it writes
  nothing to the record, so it and the terminal's notice don't quiet each other.
- **The daily check, in the server.** `ork ui` can run for days, so its server
  runs the same check when it starts and asks hourly whether one is due, by the
  same record: the machine still asks the registry at most once a day, whoever
  asks. Off by `ORK_NO_UPDATE_CHECK`, `NO_UPDATE_NOTIFIER` or `CI`
  (`check: { on: false, reason: "CI is set" }`); then it neither asks nor
  reports a newer version. The terminal, `--json` and detached rules don't
  apply: they're about stderr. `ork ui --serve`, the child that serves, starts
  no detached check of its own.
- **The plan** (`POST /api/upgrade/plan`) is `ork upgrade`'s, from the core's
  `planUpgrade`: it asks the registry now (15 s, even with the check off) and
  records the answer as `ork upgrade` does, then answers `unreachable`,
  `latest`, a `command` (the installer's id and label, its exact argv, the
  release notes, the runs still running) or `advice` (its text, the installer
  when one matched), each with a `planId`.
- **The upgrade** (`POST /api/upgrade`, `{ planId }`) asks again and runs the
  server's own command, never one the page sends, only when the plan's id still
  matches: 409 "The plan changed since you read it: …" otherwise, 409 while one
  runs (one at a time per server), 400 for advice or when the registry can't be
  reached. The package manager runs with no shell and no standard input, its
  stdout and stderr kept as the last 2,000 lines with ANSI codes taken out, and
  streamed on `/api/upgrade/stream` (`output` per line with `id:` its seq, then
  `end` with the state, the exit code and the version), which a reload or
  another tab reads from `Last-Event-ID` or `?after=`. The job is kept for the
  server's life.
- **The restart** (`POST /api/restart`) is `ork ui`'s
  ([ui](../server.md#ork-ui)): 202 with the port and the old pid, then the
  server closes and `ork ui` starts the launcher again on the same port with the
  same token. 409 while an upgrade runs; 400 "This server can't restart itself;
  stop it and run `ork ui`." for a server `ork ui` didn't start.
