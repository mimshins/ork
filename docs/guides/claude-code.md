# Ork from Claude Code

Claude Code can work with Ork beside you in your project: write a workflow and
check it until Ork accepts it, read your runs, and start one when you say so.
Install Ork's plugin once, in Claude Code:

```
/plugin marketplace add mimshins/ork
/plugin install ork@ork
```

It needs `ork` on your `PATH`
([installation](../getting-started/installation.md)). It brings:

- **Skills:** `/ork:write` (the workflow format, and checking each draft),
  `/ork:run` (starting and following runs), and `/ork:principles` (how Ork
  splits work so it costs less). Claude Code uses them when they fit.
- **Ork's tools,** through `ork mcp`: your projects, workflows and runs, what
  they spent, `check` for a workflow, what a node's session loads, and
  `start_run`.

Then ask it things such as:

- "Write a workflow that runs the tests and asks me before it pushes." It checks
  each draft as `ork validate` does, until it's clean.
- "Which of my runs failed today, and why?"
- "What would the `review` node load into its session?"
- "Start the `release` workflow." It asks you first, as a run spends money.

It can't act for you. No tool answers a decision, or stops, pauses or resumes a
run, and the plugin stops Claude Code running `ork decide`: when something waits
on you, it says so, and you answer in `ork ui` or with `ork decide` in your own
terminal. Inside a run, its sessions can read and check, but not start another
run.

## Without the plugin

Put the skills in your project, so everyone who clones it gets them, as
`/ork-write`, `/ork-run` and `/ork-principles`:

```sh
ork init --skills
```

`ork doctor` says when they're older than your Ork. Then add the tools:

```sh
claude mcp add ork -- ork mcp
```

The tools in full: [ork mcp](../../specs/cli/mcp.md). How it all fits:
[Ork for Claude Code](../../specs/claude-code.md).
