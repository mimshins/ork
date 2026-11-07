# Setup, upgrades and the browser view

_Part of [Troubleshooting](../troubleshooting.md)._

## Setup

**`! claude (sdk driver)  no API key or cloud provider`.** The SDK driver needs
`ANTHROPIC_API_KEY`, or Bedrock, Vertex or Foundry
([accounts](../accounts.md#the-agent-sdk-driver-driver-sdk)). If your `claude`
login is ready instead, that's enough: a workflow that names no driver uses the
one that's ready. For one that names `sdk`, run it with the CLI driver:

```sh
ork run <workflow> --driver cli
```

**`No Claude driver is ready here, and … name none.`** Neither your `claude`
login nor an API key is set up, and the nodes it names don't pick a driver, so
the run doesn't start. The message gives each driver's hint, such as logging in
with `claude` or setting `ANTHROPIC_API_KEY`, then ``See `ork doctor`.`` Do what
one hint says, or run `ork doctor` for the same ([accounts](../accounts.md)).

**`claude` is older than 2.1.281.** Update Claude Code. Older versions may not
read `AGENTS.md`, so a project with only `AGENTS.md` would run without its
instructions.

**`ork: command not found`.** Install it, then check that npm's global `bin`
folder is on your `PATH`; this prints the folder above it:

```sh
npm install --global @krapht/ork
npm prefix --global
```

Running from a clone instead? Check the alias from
[Installation](../../getting-started/installation.md#install-from-source), and
run `pnpm build` in the clone after pulling.

**Node version errors.** Ork needs Node 24.20 or later (`node --version`).

## Upgrading

**A line says a newer Ork is out.** Upgrade, or only look:

```sh
ork upgrade
ork upgrade --check
```

To stop the daily check, set `ORK_NO_UPDATE_CHECK=1`
([updating](../../getting-started/installation.md#updating)).

**`ork upgrade`, or Upgrade… in the browser, fails with a permissions error.** A
global install can need more rights than you have. Run the command it shows in a
terminal yourself, with your package manager's usual fix, such as a Node
installed through a version manager.

**Ork's skills for Claude Code are old.** `ork doctor` says so after an upgrade.
Write them again:

```sh
ork init --skills
```

## The browser view

**`ork ui` can't start because port 4417 is taken.** Start it on another port:

```sh
ork ui --port 4500
```

**The browser didn't open.** On a server, or without `open` or `xdg-open`,
`ork ui` prints a sign-in link instead. To only print it:

```sh
ork ui --no-open
```

**The page says it's from an older Ork.** `ork ui` was restarted on a new
version while the tab was open. Choose **Reload**.
