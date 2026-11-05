# Ork from Claude Code

Claude Code can read what Ork has while it works with you in your project: your
projects and workflows, the workflow format, your runs, what they spent, and the
decisions waiting on you. Add Ork's tools once:

```sh
claude mcp add ork -- ork mcp
```

Then ask it things such as "which of my runs failed today, and why?" or "what
fields does a `human.gate` take?". It answers from the same place `ork ui` does.

It can't act for you. No tool answers a decision, or starts, stops or pauses a
run: when something waits on you, it says so, and you answer in `ork ui` or with
`ork decide` in your terminal.

Checking a draft workflow, starting a run, skills that teach Claude Code how Ork
workflows are written, and a plugin with all of it are on their way
([RFC-012](../../rfcs/active/RFC-012-teaching-claude-code-ork.md)). The tools in
full: [ork mcp](../../specs/cli/mcp.md).
