# Installation

Ork is a command-line tool, `ork`, that runs on your own machine. This page
covers what you need, how to install Ork, and how to check that everything
works.

Rather have your coding agent install and set up Ork? See
[With your agent](./with-your-agent.md).

> **Ork is in alpha.** It is published on npm as `@krapht/ork`; expect the
> workflow format and commands to change until 1.0.0.

## What you need

**Required:**

| Tool                       | Why                                       | Check                       |
| -------------------------- | ----------------------------------------- | --------------------------- |
| **Node.js 24.20 or later** | Ork runs on Node                          | `node --version`            |
| **git**                    | Each writing node works in a git worktree | `git --version`             |
| **One Claude driver**      | The agents themselves (below)             | `ork doctor`, after install |

How to get Node and git on your system: [Your platform](#your-platform).

**Optional**, only when a workflow uses them. Ork works without any of these;
install one only if your workflows have a node of its type. A front-end project
that never touches AWS never needs `aws`.

| Tool  | Needed for                                 | Check                         |
| ----- | ------------------------------------------ | ----------------------------- |
| `gh`  | `tool.gh` nodes: pull requests, issues, CI | `gh auth status`              |
| `aws` | `tool.aws` nodes                           | `aws sts get-caller-identity` |

For Claude, pick one way in (Ork uses your own login and never stores it; see
[Accounts and credentials](../guides/accounts.md)):

- **The CLI driver** (`driver: cli`): your own
  [Claude Code](https://code.claude.com/docs) (`claude`), logged in by you.
  Version **2.1.281 or later**, so it reads `AGENTS.md`; `ork doctor` warns on
  an older one.
- **The Agent SDK driver** (`driver: sdk`): set `ANTHROPIC_API_KEY`, or use
  Amazon Bedrock, Google Vertex or Microsoft Foundry
  (`CLAUDE_CODE_USE_BEDROCK=1`, `CLAUDE_CODE_USE_VERTEX=1` or
  `CLAUDE_CODE_USE_FOUNDRY=1`, with that cloud's own credentials).

Ork is free. What the agents use is billed to your API key or cloud account, or
counts against your Claude plan's limits.

## Your platform

### macOS

Supported, on Apple silicon and Intel. Ork is developed on macOS. Get Node from
[nodejs.org](https://nodejs.org), a version manager such as `fnm` or `nvm`, or
Homebrew; git comes with the Xcode command-line tools, or from Homebrew:

```sh
brew install node@24     # or the installer from nodejs.org
xcode-select --install   # git, with the command-line tools
brew install git         # or git from Homebrew instead
```

Claude Code: see [its setup guide](https://code.claude.com/docs/en/setup).

### Linux

Supported. Ork's tests run on Ubuntu in CI, and any distribution with Node 24
and git should work.

- Node: your distribution's packages are often older than 24, so prefer
  [nodejs.org](https://nodejs.org/en/download), NodeSource, or a version manager
  (`fnm`, `nvm`).
- git: your package manager. `gh` or `aws`, if a workflow needs them: your
  package manager, or each tool's own installer.

### Windows

Use **WSL 2** (Windows Subsystem for Linux) and follow the Linux steps inside
it. Keep your projects in the Linux file system (`~/…`, not `/mnt/c/…`) so git
and the worktrees stay fast.

Native Windows is **not tested yet**. Ork runs tools and `claude` directly,
without a shell, and assumes POSIX-style paths in places, so expect rough edges
there. Reports are welcome as [issues](https://github.com/mimshins/ork/issues).

## Install

```sh
npm install --global @krapht/ork
ork --version
```

With pnpm, `pnpm add --global @krapht/ork`; if pnpm says its global bin
directory isn't in `PATH`, run `pnpm setup` once and open a new terminal. pnpm
waits a day before installing a new release; name the version to skip that.

## Check your setup

```sh
ork doctor
```

`ork doctor` shows your Ork version against the last update check, then checks
Node, git, whether you are in a git repository with a commit, each Claude
driver, each optional integration, and which
[experiments](../guides/project-rules.md#trying-an-experiment) are on. It uses
each tool's own login check and never prints a token. At least one Claude driver
has to be ready; a missing `gh` or `aws` is fine unless a workflow has a node
that needs it. Example output:

```
✓ ork                  1.0.0-alpha.8 (the latest as of 2026-11-10)
✓ node                 v24.20.0
✓ git                  git version 2.39.5
✓ git repo             inside a work tree
✓ git commits          HEAD exists
! claude (sdk driver)  no API key or cloud provider
  Set ANTHROPIC_API_KEY (or CLAUDE_CODE_USE_BEDROCK=1 / CLAUDE_CODE_USE_VERTEX=1 / CLAUDE_CODE_USE_FOUNDRY=1) to use the SDK driver.
✓ claude (cli driver)  2.1.314 (Claude Code), logged in (claude.ai, firstParty)
- gh                   optional, not installed (needed only for tool.gh nodes)
- aws                  optional, not installed (needed only for tool.aws nodes)
✓ git identity         user.name and user.email are set
✓ sockets              39 of 103 bytes
✓ experiments          none on
```

Only the CLI driver is ready and neither optional tool is installed: a working
setup. When nothing required is missing, that is all it prints. Else it ends:

```
Not ready: Ork needs Node, git, and at least one Claude driver.
```

A workflow that names no driver, like the one `ork init` writes, runs on the one
ready here (the CLI driver when both are), and `ork run` says which. A driver
named by the node, its agent, `defaults` (workflow or `.ork/project.yaml`), or
`--driver sdk|cli` wins. With none ready, `ork run` stops before any session
starts. `ork resume` keeps the run's driver.

## Updating

```sh
ork upgrade           # upgrades Ork the way you installed it, after asking
ork upgrade --check   # only says whether a newer version is out
```

`ork upgrade` sees whether npm, pnpm, yarn, bun or Volta installed Ork, shows
the command, and runs it when you say yes; a clone or `npx` gets instructions.
After an upgrade, [What's new](../whats-new.md) says what changed.

- **The daily check.** Once a day, in the background, Ork asks the npm registry
  whether a newer version is out, and tells you in one line after a command. It
  sends nothing about you or your projects. `ork doctor` shows your version
  against the last check.
- **When it's off:** in CI, without a terminal, and with `--json`. There
  `ork doctor` says why: `the daily update check is off here: no terminal`.
- **Turning it off everywhere:** set `ORK_NO_UPDATE_CHECK=1` (or
  `NO_UPDATE_NOTIFIER=1`). To ask a mirror instead, set `ORK_UPDATE_REGISTRY`.
- **Staying on a version.** Until 1.0.0 every pre-release is also `latest`. To
  keep 0.4, install `@krapht/ork@0.4` and set `ORK_NO_UPDATE_CHECK=1`.
- **In `ork ui`:** a banner, with an upgrade and a restart in the page
  ([new versions](../guides/browser-view/new-versions.md)). The same variables
  turn it off; set them where you start `ork ui`.

## The browser view

```sh
ork ui
```

`ork ui` opens your runs in the browser, already signed in; your runs keep going
without it. See [the browser view](../guides/browser-view.md).

## Install from source

For working on Ork itself, or trying changes that are not released yet. You need
[pnpm](https://pnpm.io); Corepack, which comes with Node, installs the exact
version the repository pins:

```sh
corepack enable
git clone https://github.com/mimshins/ork.git
cd ork
pnpm install
pnpm build          # bundles the CLI into packages/cli/dist/bin.mjs
# then make that build your ork, in ~/.zshrc or ~/.bashrc:
alias ork="node $HOME/path/to/ork/packages/cli/dist/bin.mjs"
```

Run `pnpm build` again after you pull. Inside the clone, `pnpm ork <command>`
runs the CLI from its TypeScript sources, with no build.

## Removing Ork

See [Where Ork keeps things](../guides/where-ork-keeps-things.md#removing-ork).

## Next

[Quickstart](./quickstart.md): your first workflow, from `ork init` to a
finished run. And [tab completion](../guides/tab-completion.md) for your shell.
