# Accounts and credentials

Ork is free and runs on your machine. It **never stores, proxies or asks for
credentials**. Each integration uses the tool you already have, logged in by
you, and Ork only checks whether it is ready. Only Claude is required; the
others are optional, needed only when a workflow has a node of their type. Why:
[ADR-004](../../decisions/ADR-004-no-credentials.md).

| Integration | How Ork reaches it                                                            | You log in with                          |
| ----------- | ----------------------------------------------------------------------------- | ---------------------------------------- |
| Claude      | the Agent SDK driver, with an API key or a cloud provider                     | `ANTHROPIC_API_KEY`, or Bedrock / Vertex |
| Claude      | the CLI driver, running your own `claude`                                     | `claude` (Claude Code's own login)       |
| GitHub      | optional: your `gh` CLI, for `tool.gh` nodes                                  | `gh auth login`                          |
| AWS         | optional: your `aws` CLI, for `tool.aws` nodes (`profile`, `region` per node) | `aws sso login`, or a profile            |

`ork doctor` runs each tool's own status check and prints whether it is ready,
never a token.

## Claude: pick a driver

### The Agent SDK driver (`driver: sdk`, the default)

Runs Claude Code through Anthropic's Agent SDK, inside Ork's process. It
**refuses to start** unless one of these is set in your environment:

- `ANTHROPIC_API_KEY`: a key from the
  [Claude Console](https://console.anthropic.com).
- `CLAUDE_CODE_USE_BEDROCK=1`, with your AWS credentials for Amazon Bedrock.
- `CLAUDE_CODE_USE_VERTEX=1`, with your Google Cloud credentials for Vertex AI.
- `CLAUDE_CODE_USE_FOUNDRY=1`, for Microsoft Foundry.

This is the clearly supported way to run Claude from another tool.

### The CLI driver (`driver: cli`)

Runs your own `claude` binary, headless, with whatever it is logged in with. Ork
never reads that login. Requires Claude Code 2.1.281 or later.

> **A note on subscriptions.** Anthropic's terms do not allow third-party
> products to offer claude.ai login, or to route requests through Free, Pro or
> Max plan credentials on a user's behalf. Ork does neither: it runs the
> `claude` you installed and logged into. Still, check Anthropic's current terms
> before using the CLI driver with a subscription login; with an API key or a
> cloud provider it is fine.

## Secrets in workflows

Never write a secret into a workflow file; they are meant to be committed. Use
environment variables, which your tools read themselves. Files a worktree needs
but git ignores, such as `.env`, can be listed in `.worktreeinclude`
([Worktrees](./worktrees.md#what-a-worktree-contains)).

## What Ork keeps

Run state lives in `.ork/runs/` in your project, which `ork init` adds to
`.gitignore`. Nothing is sent anywhere except to the tools you run.
