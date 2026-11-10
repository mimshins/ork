# With your agent

Your coding agent can set Ork up for you, write workflows that Ork accepts, and
tell you what your runs did. This page shows how, for Claude Code, for any agent
that speaks MCP, and for an agent that only has a shell. Ork does the same
things with any of them; what changes is how the agent reaches it.

To do it all yourself instead, start with [Installation](./installation.md) and
the [Quickstart](./quickstart.md).

## Claude Code

Install Ork's plugin once, in Claude Code:

```
/plugin marketplace add mimshins/ork
/plugin install ork@ork
```

It brings Ork's skills (`/ork:setup`, `/ork:write`, `/ork:run` and
`/ork:principles`) and Ork's tools, through `ork mcp`. The tools need `ork` on
your `PATH`; until it is there, `/mcp` shows the `ork` server as failed, but the
skills work. Then ask it, in your repository:

```
Set up Ork in this repository.
```

Claude Code checks for `ork` and runs `ork doctor`, then sets up the project,
makes Ork's tools available, and offers a first workflow. It asks you before
each step that changes something:

- **Installing Ork**, when `ork` is missing. It shows the command first.
- **Where Ork's files go:** in the repository with `ork init`, or beside it with
  `ork register`, which writes nothing into the repository
  ([projects](../guides/projects.md)).
- **Editing a config,** such as adding Ork's tools to Claude Code.
- **Starting a run,** because a run spends your money.

When it has installed `ork`, restart Claude Code, or reconnect `ork` in `/mcp`,
so the tools start. If no agent driver is ready, it tells you how to log in; you
do that yourself (see [below](#what-an-agent-cant-do-for-you)).

Then ask it things such as:

```
Write a workflow that runs the tests and asks me before it pushes.
```

```
Which runs failed today, and why?
```

```
Start the hello workflow with the task "add a README".
```

It checks each draft as `ork validate` does, until Ork accepts it, and asks you
before it starts a run. More in
[Ork from Claude Code](../guides/claude-code.md), including the skills in your
repository instead of the plugin.

## Any MCP client

Claude Desktop, Cursor, Codex and other MCP clients can use Ork's tools through
`ork mcp`. First, install Ork and set up the project yourself, in a terminal in
your repository, so the tools can find it:

```sh
npm install --global @krapht/ork
ork doctor
ork init          # or: ork register, to keep Ork's files out of the repository
```

Then add a server named `ork` that runs `ork mcp`. Most clients take this shape
in their MCP config:

```json
{
  "mcpServers": {
    "ork": { "command": "ork", "args": ["mcp"] }
  }
}
```

- **Claude Desktop:** Settings, Developer, Edit Config opens
  `claude_desktop_config.json`.
- **Cursor:** `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for
  every project.
- **Codex:** `~/.codex/config.toml`, in TOML:

  ```toml
  [mcp_servers.ork]
  command = "ork"
  args = ["mcp"]
  ```

- **Others:** the client's own MCP docs; the command is `ork` and its one
  argument is `mcp`.

A desktop app may not see your shell's `PATH`. If it can't start `ork`, give it
the full path that this prints:

```sh
command -v ork
```

**What the tools can do:** list your projects, workflows and runs; show a run's
events, what it spent, and the decisions waiting on you; give the workflow
format; check a workflow as `ork validate` does; explain what a node's session
loads; and start a run. Every tool but the one that starts a run is marked
read-only, so a client that asks before a tool with effects asks you first.

**What they can't:** answer a decision, or stop, pause, resume or message a run.
Those are yours ([below](#what-an-agent-cant-do-for-you)).

Other clients don't load Ork's skills, the rules Claude Code follows when it
writes a workflow. Point your agent at them, or at the guide:

```
Read https://github.com/mimshins/ork/tree/main/plugins/ork/skills before you write an Ork workflow, and check every draft with Ork's check tool.
```

The tools in full: [ork mcp](../../specs/cli/mcp.md).

## An agent with only a shell

An agent that can run commands but has no MCP can use the CLI, as you would.
Give it a place to start:

```
Set up Ork in this repository. Start with `ork --help` and `ork doctor`, read https://github.com/mimshins/ork/tree/main/docs, and ask me before you install anything or change a file.
```

The commands it needs first:

```sh
ork --help        # every command; `ork <command> --help` for one
ork doctor        # what's ready and what isn't
ork validate      # checks the workflows in .ork/workflows/
ork ps            # runs, newest first
```

The [guides](../README.md#guides) explain the rest, such as
[writing workflows](../guides/writing-workflows.md) and
[running them](../guides/running-workflows.md).

## What an agent can't do for you

- **Answer a run's decisions.** A gate, a loop that ran out of rounds, a
  permission: Ork stops there so a person decides what can't be undone, such as
  a merge or a deploy. An agent that answered would remove the reason for the
  question. You answer in `ork ui` or with `ork decide` in your own terminal. No
  tool answers one, and Ork's Claude Code plugin stops Claude Code answering
  with `ork decide`.
- **Log in for you.** Ork never asks for, stores or passes on a credential; each
  tool uses its own login, which you do yourself:

  ```sh
  claude            # then /login, for the claude-code driver
  gh auth login     # for tool.gh nodes
  aws sso login     # for tool.aws nodes, or your own profile
  ```

  Instead of a `claude` login, you can set `ANTHROPIC_API_KEY` (or Bedrock,
  Vertex or Foundry) in your own shell. Don't paste a key into a conversation
  with an agent: it ends up in the transcript. See
  [Accounts and credentials](../guides/accounts.md).

- **Spend without asking.** An agent following Ork's skills starts a run only
  when you say so, and Claude Code asks you before the tool that starts one.

## Next

Open the browser view, in your own terminal, to watch your runs and answer what
they ask:

```sh
ork ui
```

See [the browser view](../guides/browser-view.md).
