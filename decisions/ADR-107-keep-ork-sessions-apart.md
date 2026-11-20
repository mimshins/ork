# ADR-110 — Keep Ork's sessions apart from a project's own agent process

- **Status:** Accepted
- **Date:** 2026-11-20
- **Topic:** context, project rules, runtime port, CLI
- **RFC:** waived by the maintainer (a decision made directly; options below)

## Context

Repositories such as se-backend, se-client-kit and se-contracts run their own
agent process: an `AGENTS.md` that names a documenter, an implementer, a human
review and a reviewer, and agent files for each. People who work in them use
their own tools and never run Ork. Ork runs those same steps as nodes of a
workflow, so an Ork session met two processes at once: it could start the
repository's role agents itself, wait for a human the workflow already gates,
open Claude Code's own question prompt that no one in a headless run can answer,
and write "the review node passed" into files and pull requests that other
contributors read. It was kept apart by hand: a `~/.ork/context/ork-session.md`,
per-project `Agent(<role>)`, `Task(<role>)` and `AskUserQuestion` denies, and
care about what lands in the repository. Each project needed the stopgap, and a
missed one leaked Ork into shared knowledge.

## Decision

Ork keeps the separation itself, with six parts, all built for `claude-code`
first and the write limit for every driver that can hold it:

1. **Session text, always on.** `harnessInstructions` says a session is one node
   of an Ork workflow: do only its step; never start another step's role agent
   (only sub-agent nodes it owns); human gates are not its to wait for or ask;
   ask with `ask_user`; never stage, commit, push or post unless its brief says
   the node does. No setting, no detection, no wording about the repository's
   docs.
2. **`AskUserQuestion` withheld** in every driver's deny list, on every reading
   rule, unless the node names it in `tools.allow` or `tools.only`
   (`ASKING_TOOLS`, beside the `Grep` and `Glob` pattern).
3. **`rules.agents: open | isolate`**, in `project.yaml` and a workflow's
   `rules:` (the workflow's wins), default `open`. Under `isolate` a node's
   `tools.deny` carries `Agent(<name>)` and its alias `Task(<name>)` for each
   agent that fills another node, never its own agent nor its sub-agent
   children's.
4. **Attached context.** In an attached project a context reference that
   resolves inside `<root>/.ork/` reads the same path in
   `~/.ork/projects/<id>/`, plain files only; a link or an escape is refused
   with a `ref.context` error naming the folder. The reference text is the same
   in both modes and `ork migrate` moves the files unchanged.
5. **The `quiet` practice**, built in and on by default, resolved like `caveman`
   and `ponytail` and appended after them: never write about Ork into a
   repository file, commit message, pull request text, review comment or code
   comment; Ork's own notes stay in `.ork/`. Ork's own repository sets
   `defaults.practices.quiet: false`.
6. **`knowledge: any | ork-only`**, in `project.yaml` alone, default `any`.
   Under `ork-only`, `ork feedback apply` starts its worker with
   `SessionSpec.writeOnly` set to `.ork/`: a Write or Edit of any other path,
   and of any file named CLAUDE.md or AGENTS.md anywhere, is refused at the call
   (the Claude Code hook; Codex, Command Code and omp through the shared
   matcher; OpenCode, which cannot hold it, refuses the run). In an attached
   project apply refuses and says why, because its Ork folder is outside the
   repository.

`ork init` and `ork migrate --agents` only warn that linked tool folders and
`.ork/skills` reach every contributor's own agent tool, naming `--no-link` and
`--no-skills`; their defaults stay. `ork doctor` warns about a CLAUDE.md or
AGENTS.md under `.ork/` and `ork migrate` refuses to move one there.

## Options considered

- **Keep the stopgap by hand (status quo).** Costs nothing in Ork and leaks when
  a project forgets one deny. Rejected: the point is that a project needs none.
- **A setting for the session text, or detection of a project's own process.**
  Detecting `AGENTS.md` and its agent files is guessing at another tool's
  conventions, and a setting is one more thing to forget. Rejected: the lines
  are short, hold for any project and are cached.
- **`rules.agents` as the default, or as a list of names.** A default changes
  every existing workflow; a list restates what the workflow already says.
  Rejected for one switch, `open` by default, matching by the workflow's agent
  keys.
- **Attached context under its own syntax (`~` or an `attached:` prefix).**
  Different references per mode, and `ork migrate` would rewrite files. Rejected
  for mapping the `.ork/` form, which is what an in-repo project writes.
- **Detect the leak after the fact (a check on the diff for words about Ork).**
  A heuristic with false positives that cannot see a pull request body. Rejected
  for telling the session, and for the write limit where the files are known.
- **`ork feedback apply` editing an attached Ork folder in place.** An engine
  path for a worktree outside the repository, for a feature no one asked for.
  Refused for now (a gap), the maintainer edits by hand.
- **`quiet` off by default.** Safe for Ork's own repository, wrong for every
  project that shares knowledge with people outside Ork. Rejected: this
  repository opts out instead.

## Consequences

- Three hard-to-reverse choices: the `rules.agents` and `knowledge` keys (both
  now in the project and workflow formats, and in the generated JSON Schemas;
  optional, so `schemaVersion` stays 1 and no migration is needed), and the
  `quiet` practice on by default, which changes every Claude session's system
  prompt (about 120 tokens, cached) and tells every node to write nothing about
  Ork. A project that wants its nodes to write about Ork sets
  `practices: { quiet: false }`.
- The session text adds about 150 tokens to every Claude session, cached.
- A workflow that wants `AskUserQuestion` names it in a node's `tools.allow`.
- The runtime port gains `SessionSpec.writeOnly`. It limits the edit tools, not
  the shell, and is not carried to nested `workflow.call` runs, `ork resume` or
  the owner-asks session; `rules.agents: isolate` matches by name only and
  probably holds only on `claude-code`; apply is refused for attached projects;
  `ork link` does not warn and no `.ork/README.md` tells outside agents what the
  folder is; explain's watch list still names `<root>/.ork/` for a mapped file.
  Each is a row in [gaps](../specs/gaps/session-apart-limits.md).
- Specs:
  [agents and knowledge rules](../specs/project-rules/agents-and-knowledge.md),
  [session text, `quiet`, attached context](../specs/context/session-apart.md),
  [the write limit](../specs/runtime/write-limit.md),
  [a fix under `knowledge: ork-only`](../specs/feedback/closing-the-loop.md#a-fix-under-knowledge-ork-only).
  Builds on [ADR-021](./ADR-021-built-in-practices.md),
  [ADR-032](./ADR-032-project-rules.md) and
  [ADR-035](./ADR-035-projects-in-repo-or-attached.md).
- No new runtime dependency and no new command, flag, event or MCP tool.
