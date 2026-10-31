# Installation

Ork is a command-line tool, `ork`, that runs on your own machine. This page
covers what you need, how to install Ork today, and how to check that everything
works.

> **Ork is pre-alpha and not on npm yet.** The first release (`@krapht/ork`
> 0.1.0) is being prepared. Until it ships, install Ork from source, as
> described below. It takes about two minutes.

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

## Install from source (today)

You need [pnpm](https://pnpm.io). Corepack, which comes with Node, installs the
exact version the repository pins:

```sh
corepack enable
git clone https://github.com/mimshins/ork.git
cd ork
pnpm install
pnpm build          # bundles the CLI into packages/cli/dist/bin.mjs
```

Then make `ork` available in your other projects. The simplest way is an alias
in your shell's startup file (`~/.zshrc` or `~/.bashrc`):

```sh
alias ork="node $HOME/path/to/ork/packages/cli/dist/bin.mjs"
```

Run `pnpm build` again after you pull new changes. Inside the Ork clone itself,
`pnpm ork <command>` runs the CLI straight from its TypeScript sources, with no
build.

## After the first release

Once `@krapht/ork` is published, installing is one command on any platform Node
supports:

```sh
npm install --global @krapht/ork
```

A one-line installer for macOS with standalone binaries that need no Node
(`curl -fsSL …/install.sh | sh`, then `ork upgrade` to update) is proposed in
[RFC-002](../../rfcs/active/RFC-002-standalone-binaries-and-installer.md). It is
not built yet.

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

`ork doctor` checks Node, git, whether you are in a git repository, each Claude
driver, and each optional integration. It uses each tool's own login check and
never prints a token. At least one Claude driver has to be ready; a missing `gh`
or `aws` is fine unless a workflow has a node that needs it. Example output:

```
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

## Next

[Quickstart](./quickstart.md): your first workflow, from `ork init` to a
finished run.
