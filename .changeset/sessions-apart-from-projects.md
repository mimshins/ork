---
"@krapht/ork": minor
---

Keep Ork sessions apart from a project's own agent process. Every Claude session
says it is one node of an Ork workflow, `AskUserQuestion` is denied unless a
node names it, and `rules.agents: isolate` denies `Agent(<name>)` for the agents
of other nodes. A new default-on `quiet` practice tells nodes never to write
about Ork into repository files, commits or pull requests
(`practices: { quiet: false }` turns it off). In a project registered from
outside, a context path into `.ork/` reads `~/.ork/projects/<id>/`;
`knowledge: ork-only` limits `ork feedback apply` to the project's `.ork/` and
refuses it for an attached project. `ork init` and `ork migrate --agents` warn
about linked tool folders, and `ork doctor` and `ork migrate` flag a `CLAUDE.md`
or `AGENTS.md` under `.ork/`.
