# Ork from Claude Code

Claude Code can work with Ork beside you in your project: write a workflow and
check it until Ork accepts it, read your runs, and start one when you say so.

To install Ork's plugin and have Claude Code set up your project, start with
[With your agent](../getting-started/with-your-agent.md#claude-code). This page
is what the plugin does once it's there. It needs `ork` on your `PATH`
([installation](../getting-started/installation.md)), and brings:

- **Ork's skills for Claude Code:** `/ork:setup` (setting Ork up in a
  repository, asking before each change), `/ork:write` (the workflow format, and
  checking each draft), `/ork:run` (starting and following runs), and
  `/ork:principles` (how Ork splits work so it costs less). Claude Code uses
  them when they fit.
- **Ork's tools,** through `ork mcp`: your projects, workflows and runs, what
  they spent, `check` for a workflow, what a node's session loads, and
  `start_run`.

Then ask it things such as:

- "Set up Ork in this repository." It checks your setup, and asks before it
  installs anything, changes your repository or a config, or starts a run
  ([With your agent](../getting-started/with-your-agent.md)).
- "Write a workflow that runs the tests and asks me before it pushes." It checks
  each draft as `ork validate` does, until it's clean.
- "Which of my runs failed today, and why?"
- "What would the `review` node load into its session?"
- "Start the `release` workflow." It asks you first, as a run spends money.

It can't act for you. No tool answers a decision, or stops, pauses or resumes a
run, and the plugin stops Claude Code answering with `ork decide` (it may still
list what's open): when something waits on you, it says so, and you answer in
`ork ui` or with `ork decide` in your own terminal. Inside a run, its sessions
can read and check, but not start another run.

## Without the plugin

Put Ork's skills for Claude Code in your project, so everyone who clones it gets
them, as `/ork-setup`, `/ork-write`, `/ork-run` and `/ork-principles`:

```sh
ork init --skills
```

`ork doctor` says when they're older than your Ork. Then add the tools:

```sh
claude mcp add ork -- ork mcp
```

These are not the skills Ork gives a node in a run, such as `ork:review`; those
are in [skills and context](./skills-and-context.md).

For the full rules: [ork mcp](../../specs/cli/mcp.md) and
[Ork for Claude Code](../../specs/claude-code.md).
