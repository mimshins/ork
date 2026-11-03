# Installation

Ork is a command-line tool, `ork`, that runs on your own machine. This page
covers what you need, how to install Ork, and how to check that everything
works.

> **Ork is pre-alpha.** It is published on npm as `@krapht/ork`; expect the
> workflow format and commands to change between 0.x releases.

## What you need

**Required:**

| Tool                       | Why                                       | Check                       |
| -------------------------- | ----------------------------------------- | --------------------------- |
| **Node.js 24.20 or later** | Ork runs on Node                          | `node --version`            |
| **git**                    | Each writing node works in a git worktree | `git --version`             |
| **One Claude driver**      | The agents themselves (below)             | `ork doctor`, after install |

**Optional**, only when a workflow uses them. Ork works without any of these;
install one only if your workflows have a node of its type. A front-end project
that never touches AWS never needs `aws`.

| Tool  | Needed for                                 | Check                         |
| ----- | ------------------------------------------ | ----------------------------- |
| `gh`  | `tool.gh` nodes: pull requests, issues, CI | `gh auth status`              |
| `aws` | `tool.aws` nodes                           | `aws sts get-caller-identity` |

For Claude, pick one way in (Ork uses your own login and never stores it; see
[Accounts and credentials](../guides/accounts.md)):

- **The Agent SDK driver** (`driver: sdk`, the default): set
  `ANTHROPIC_API_KEY`, or use Amazon Bedrock or Google Vertex
  (`CLAUDE_CODE_USE_BEDROCK=1` or `CLAUDE_CODE_USE_VERTEX=1` with that cloud's
  own credentials).
- **The CLI driver** (`driver: cli`): your own
  [Claude Code](https://code.claude.com/docs) (`claude`), logged in by you.
  Version **2.1.281 or later**, so it reads `AGENTS.md`; `ork doctor` warns on
  an older one.

## Install

```sh
npm install --global @krapht/ork
ork --version
```

This works on any platform Node supports (see [Your platform](#your-platform)).

## Updating

```sh
ork upgrade           # upgrades Ork the way you installed it, after asking
ork upgrade --check   # only says whether a newer version is out
```

`ork upgrade` sees whether npm, pnpm, yarn, bun or Volta installed Ork, shows
the command it will run, and runs it when you say yes. A copy run from a clone
or through `npx` gets instructions instead.

Once a day, Ork also asks the npm registry, in the background, whether a newer
version is out, and tells you in one line after a command. This is the only
request Ork makes on its own, and it sends nothing about you or your projects.
It is off in CI, without a terminal and with `--json`; turn it off everywhere
with `ORK_NO_UPDATE_CHECK=1` (or `NO_UPDATE_NOTIFIER=1`), or point it at a
mirror with `ORK_UPDATE_REGISTRY`. `ork doctor` shows your version against the
last check.

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
```

Then make that build your `ork` in other projects, for example with an alias in
your shell's startup file (`~/.zshrc` or `~/.bashrc`):

```sh
alias ork="node $HOME/path/to/ork/packages/cli/dist/bin.mjs"
```

Run `pnpm build` again after you pull new changes. Inside the Ork clone itself,
`pnpm ork <command>` runs the CLI straight from its TypeScript sources, with no
build.

## Your platform

### macOS

Supported, on Apple silicon and Intel. Ork is developed on macOS.

- Node: the installer from [nodejs.org](https://nodejs.org), or
  `brew install node@24`, or a version manager such as `fnm` or `nvm`.
- git: comes with the Xcode command-line tools (`xcode-select --install`), or
  `brew install git`.
- Claude Code: see [its setup guide](https://code.claude.com/docs/en/setup).

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

## Check your setup

```sh
ork doctor
```

`ork doctor` shows your Ork version against the last update check, then checks
Node, git, whether you are in a git repository, each Claude driver, and each
optional integration. It uses each tool's own login check and never prints a
token. At least one Claude driver has to be ready; a missing `gh` or `aws` is
fine unless a workflow has a node that needs it. Example output:

```
✓ ork                  0.1.0 (the latest as of 2026-11-02)
✓ node                 v24.20.0
✓ git                  git version 2.39.5
✓ git repo             inside a work tree
! claude (sdk driver)  no API key or cloud provider
  Set ANTHROPIC_API_KEY (or CLAUDE_CODE_USE_BEDROCK=1 / CLAUDE_CODE_USE_VERTEX=1) to use the SDK driver.
✓ claude (cli driver)  2.1.314 (Claude Code), logged in (claude.ai, firstParty)
- gh                   optional, not installed (needed only for tool.gh nodes)
- aws                  optional, not installed (needed only for tool.aws nodes)
✓ git identity         user.name and user.email are set
```

Here only the CLI driver is ready and neither optional tool is installed, which
is a working setup. Run workflows with `--driver cli` or set
`defaults.driver: cli` in the workflow.

## The browser view

```sh
ork ui              # starts it on http://127.0.0.1:4417 and opens your browser
ork ui --port 4500  # another port, if 4417 is taken
ork ui --no-open    # only print the address and the sign-in link
```

`ork ui` starts Ork's local server and opens it in your browser, already signed
in: a workspace of panels for your runs, their graphs and logs, the questions
they are waiting on, a chat with each node, and notifications. Ctrl-C stops it;
your runs keep running, and every `ork` command works without it. The designer
comes in a later release. See [the browser view](../guides/browser-view.md).

It listens only on `127.0.0.1`, and only your browser gets in: `ork ui` opens it
with a one-time link that becomes a cookie, and the server refuses any other
site, any other host name, and any request without it. The link's token is kept
in `~/.ork/ui.json`, readable only by you, and changes each time the server
starts. If `ork ui` cannot open a browser (on a server, or without `open` or
`xdg-open`), it prints the link for you to open.

## Next

[Quickstart](./quickstart.md): your first workflow, from `ork init` to a
finished run.
