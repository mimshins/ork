# Updates

_Part of [The ork CLI](../cli.md)._

Status: **Built** in the CLI ([notice](../../packages/cli/src/update/notify.ts),
[upgrade](../../packages/cli/src/commands/install.ts),
[core](../../packages/core/src/update/check.ts),
[installers](../../packages/core/src/update/installers.ts),
[tests](../../packages/cli/test/upgrade.test.ts),
[core tests](../../packages/core/test/update.test.ts)); the UI's notice and
upgrade are M2 ([ui](../ui.md)). Decided in
[ADR-038](../../decisions/ADR-038-update-notice-and-upgrade.md).

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
