# Ork from Claude Code

Claude Code can work with Ork beside you in your project: read your projects,
workflows and runs, check a workflow it's writing, and start a run when you say
so. Add Ork's tools once:

```sh
claude mcp add ork -- ork mcp
```

Then ask it things such as:

- "Write a workflow that runs the tests and asks me before it pushes." It checks
  each draft as `ork validate` does, until it's clean.
- "What fields does a `human.gate` take?"
- "Which of my runs failed today, and why?"
- "What would the `review` node load into its session?"
- "Start the `release` workflow." It asks you first, as a run spends money.

It can't act for you. No tool answers a decision, or stops, pauses or resumes a
run: when something waits on you, it says so, and you answer in `ork ui` or with
`ork decide` in your terminal. Inside a run, its sessions can read and check,
but not start another run.

Skills that teach Claude Code how Ork workflows are written, and a plugin with
all of it, are on their way
([RFC-012](../../rfcs/active/RFC-012-teaching-claude-code-ork.md)). The tools in
full: [ork mcp](../../specs/cli/mcp.md).
