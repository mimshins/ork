# Accounts and credentials

Ork is free and runs on your machine. It **never stores, proxies or asks for
credentials**. Each integration uses the tool you already have, logged in by
you, and Ork only checks whether it is ready. One agent driver is required
(today that is Claude); the others are optional, needed only when a workflow
names them or has a node of their type.

What the agents use is billed to your API key or cloud account, or counts
against your Claude plan's limits; a budget caps each run
([models and budgets](./models-and-budgets.md)).

| Integration  | How Ork reaches it                                                            | You log in with                                                          |
| ------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Claude       | the `claude-code` driver, running your own `claude`                           | `claude`'s own login, `ANTHROPIC_API_KEY`, or Bedrock / Vertex / Foundry |
| OpenCode     | the `open-code` driver, running your own `opencode` (unproven)                | `opencode auth login`                                                    |
| Command Code | the `command-code` driver, running your own `cmd` (unproven)                  | `cmd login`                                                              |
| GitHub       | optional: your `gh` CLI, for `tool.gh` nodes and `ork feedback publish`       | `gh auth login`                                                          |
| AWS          | optional: your `aws` CLI, for `tool.aws` nodes (`profile`, `region` per node) | `aws sso login`, or a profile                                            |

`ork doctor` runs each tool's own status check and prints whether it is ready,
never a token.

## The drivers

Ork runs agents through a **driver**: the CLI of an agent tool, run headless
([Drivers](./drivers.md) says what each does and refuses). `claude-code`, your
own `claude`, is the proven one. `open-code` and `command-code` are built but
**unproven**: `ork doctor` finds the `opencode` and `cmd` binaries and lists
them as `skip` (it does not read their logins), and a node that names one is
refused until a real session has proven it. A workflow that names no driver runs
on the one that's ready, and `ork run` says which. A driver the workflow or a
node names, or `--driver` on `ork run`, wins.

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

### The open-code driver (`driver: open-code`, unproven)

Runs your own `opencode` (tested against 2.1.0), headless. Log in with
`opencode auth login`; Ork never reads that login, and a missing one shows up in
the first session. Ork gives the session a private config with its tool
connection, and removes it when the session ends
([SECURITY.md](../../SECURITY.md)).

### The command-code driver (`driver: command-code`, unproven)

Runs your own `cmd` ([Command Code](https://commandcode.ai), tested against
1.88.5), headless. Log in with `cmd login`; Ork never reads that login either.
It runs one session per checkout at a time
([Drivers](./drivers.md#command-code-runs-one-session-per-checkout)).

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
