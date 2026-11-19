# Accounts and credentials

Ork is free and runs on your machine. It **never stores, proxies or asks for
credentials**. Each integration uses the tool you already have, logged in by
you, and Ork only checks whether it is ready. One agent driver is required
(today that is Claude); the others are optional, needed only when a workflow
names them or has a node of their type.

What the agents use is billed to your API key or cloud account, or counts
against your Claude plan's limits; a budget caps each run
([models and budgets](./models-and-budgets.md)).

| Integration  | How Ork reaches it                                                                                                           | You log in with                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Claude       | the `claude-code` driver, running your own `claude`                                                                          | `claude`'s own login, `ANTHROPIC_API_KEY`, or Bedrock / Vertex / Foundry |
| OpenCode     | the `open-code` driver, running your own `opencode`                                                                          | `opencode auth login`                                                    |
| Command Code | the `command-code` driver, running your own `cmd`                                                                            | `cmd login`                                                              |
| Codex        | the `codex` driver, running your own `codex`                                                                                 | `codex login`                                                            |
| omp          | the `omp` driver, running your own `omp` (built, not yet proven)                                                             | `omp login`                                                              |
| GitHub       | optional: your `gh` CLI, for `tool.gh` nodes, `ork feedback publish` and [follow-ups](./follow-ups.md) kept or checked there | `gh auth login`                                                          |
| AWS          | optional: your `aws` CLI, for `tool.aws` nodes (`profile`, `region` per node)                                                | `aws sso login`, or a profile                                            |

`ork doctor` runs each tool's own status check and prints whether it is ready,
never a token.

## The drivers

Ork runs agents through a **driver**: the CLI of an agent tool, run headless
([Drivers](./drivers.md) says what each does and refuses). `claude-code`, your
own `claude`, `open-code`, your own `opencode`, `command-code`, your own `cmd`,
and `codex`, your own `codex`, have each run a real session; `omp`, your own
`omp`, is built and has not yet, so a node on it is refused until it has.
`ork doctor` finds the `opencode`, `cmd`, `codex` and `omp` binaries (it does
not read their logins, except that it counts the models `omp models --json`
lists), and lists one it can't find as `skip`. A workflow that names no driver
runs on the one that's ready, and `ork run` says which. A driver the workflow or
a node names, or `--driver` on `ork run`, wins.

The ids `sdk` and `cli` of earlier versions are retired: a workflow, a
`.ork/project.yaml` or `--driver` that names one is refused with a message
naming `claude-code`. Runs recorded with them still resume, under `claude-code`.

### The claude-code driver (`driver: claude-code`)

Runs your own `claude` binary, headless. Ork never reads its credentials. It is
ready when one of these holds, and `ork doctor` says which:

- `claude` is logged in (`claude auth login`).
- `ANTHROPIC_API_KEY` is set: a key from the
  [Claude Console](https://console.anthropic.com).
- `CLAUDE_CODE_USE_BEDROCK=1`, with your AWS credentials for Amazon Bedrock.
- `CLAUDE_CODE_USE_VERTEX=1`, with your Google Cloud credentials for Vertex AI.
- `CLAUDE_CODE_USE_FOUNDRY=1`, for Microsoft Foundry.

It requires Claude Code 2.1.281 or later.

> **A note on subscriptions.** Anthropic's terms do not allow third-party
> products to offer claude.ai login, or to route requests through Free, Pro or
> Max plan credentials on a user's behalf. Ork does neither: it runs the
> `claude` you installed and logged into. Still, check Anthropic's current terms
> before using a subscription login; with an API key or a cloud provider it is
> fine.

### The open-code driver (`driver: open-code`)

Runs your own `opencode` (tested against 2.1.0), headless. Log in with
`opencode auth login`; Ork never reads that login, and a missing one shows up in
the first session. Ork gives the session a private config with its tool
connection, and removes it when the session ends
([SECURITY.md](../../SECURITY.md)).

### The command-code driver (`driver: command-code`)

Runs your own `cmd` ([Command Code](https://commandcode.ai), tested against
1.88.5), headless. Log in with `cmd login`; Ork never reads that login either.
It runs one session per checkout at a time
([Drivers](./drivers.md#command-code-runs-one-session-per-checkout)).

### The codex driver (`driver: codex`)

Runs your own `codex` (OpenAI's Codex CLI, proven on 0.169.0 with a ChatGPT
account), headless. Log in with `codex login`; Ork runs `codex login status` and
reads only its exit status, never Codex's own login files (`auth.json`).
`OPENAI_API_KEY` is not counted as a login. Ork's token for its own tools is
kept out of the shell Codex starts ([Codex](./drivers/codex.md)).

### The omp driver (`driver: omp`)

Runs your own `omp` (oh-my-pi's coding agent, built against 18.22.2), headless.
Log in with `omp login`; Ork never reads `omp`'s login files and never runs
`omp auth`, and `ork doctor` shows only the number of models your logins reach.
Your `OMP_PROFILE` or `PI_CODING_AGENT_DIR` decides the login. It is **built and
not yet proven**: `ork validate` and `ork run` refuse an `omp` node until a real
session has proven it ([omp](./drivers/omp.md)).

## Secrets in workflows

Never write a secret into a workflow file; they are meant to be committed. Use
environment variables, which your tools read themselves. Files a worktree needs
but git ignores, such as `.env`, can be listed in `.worktreeinclude`
([Worktrees](./worktrees.md#what-a-worktree-contains)).

## What Ork keeps

Ork keeps your runs, feedback and settings on your machine, in `~/.ork/` and
each project's `.ork/`. On its own, it sends only a daily version check to the
npm registry, which you can turn off, and feedback you choose to publish. The
list, and how to remove Ork:
[Where Ork keeps things](./where-ork-keeps-things.md).

Why Ork never handles a credential:
[the decision](../../decisions/ADR-004-no-credentials.md).
