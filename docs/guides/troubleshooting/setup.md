# Setup, upgrades and the browser view

_Part of [Troubleshooting](../troubleshooting.md)._

## Setup

**`! claude (claude-code driver)  …, not logged in`.** The claude-code driver
needs your `claude` logged in (`claude auth login`, which you run yourself), or
`ANTHROPIC_API_KEY`, or Bedrock, Vertex or Foundry set in your shell
([accounts](../accounts.md#the-claude-code-driver-driver-claude-code)).

**`` driver `sdk` was retired; use `claude-code` ``.** The ids `sdk` and `cli`
of earlier versions are gone. Change `driver:` in the workflow or
`.ork/project.yaml` to `claude-code`, or drop it so the run takes the one that's
ready; on the command line, use `--driver claude-code`. Runs recorded with the
old ids still resume.

**`node … sets maxTurns, but driver … has no turn limit`** (or MCP servers in
`mcp`, or delegates to the nodes it owns). The node asks for something its
driver does not do. Remove the setting, name a driver that has it, or run
`ork validate --driver claude-code` to see each node against that driver
([models and budgets](../models-and-budgets/driver-and-usage.md#the-driver)).

**`driver command-code runs one session per checkout, but … could run at once`**
(a warning from `ork validate`). Command Code holds one session per checkout at
a time, so two nodes in the same checkout, such as `shared` siblings, wait for
each other. Give those nodes `isolation: worktree`, or run them on another
driver.

**`node … runs on driver command-code, which runs one session per checkout, but … one owns another`**
(an error from `ork validate` and `ork run`). A leader and a worker it owns
share a checkout: the leader holds it while it waits on the worker, and the
worker waits for it, so neither would finish. Give the worker
`isolation: worktree`, or run one of them on another driver.

**`node … runs on driver …, which is not yet proven on a real session`.** A
driver is refused until a real session has proven it. `claude-code`, `open-code`
and `command-code` all have; name one of them, or no driver.

**`No agent driver is ready here, and … name none.`** Neither your `claude`
login nor an API key or cloud provider is set up, and the nodes it names don't
pick a driver, so the run doesn't start. The message gives each driver's hint,
such as logging in with `claude` or setting `ANTHROPIC_API_KEY`, then
``See `ork doctor`.`` Do what one hint says, or run `ork doctor` for the same
([accounts](../accounts.md)).

**`--driver command-code: command-code isn't ready here (…).`** You named a
driver with `--driver`, and its tool isn't found or isn't signed in, so the run
doesn't start. The message gives the driver's hint, then ``See `ork doctor`.``
Install or sign in to that tool (an older `claude`, or one not signed in, also
refuses `--driver claude-code`), or leave `--driver` off to use the driver that
is ready ([drivers](../drivers.md)).

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
