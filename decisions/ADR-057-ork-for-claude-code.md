# ADR-057 — Teaching Claude Code Ork's standards: `ork mcp`, skills and a plugin

- **Status:** Accepted
- **Date:** 2026-11-06
- **Topic:** CLI / integrations / distribution
- **RFC:** [RFC-012](../rfcs/archived/RFC-012-teaching-claude-code-ork.md)

## Context

Ork taught only the sessions it starts: a run's sessions get an in-process MCP
server and built-in skills. Claude Code working beside a person in their
project, outside any run, knew nothing of Ork: it guessed the workflow format,
couldn't check a draft, and didn't know Ork's case is deterministic steps first
and a model only for judgment. The maintainer asked for Ork to ship its own MCP
server and skills so agents adopt its standards, and chose the scope: all of
writing, running, Ork's principles and contributing; Claude Code only, for now;
an `ork mcp` command, skills offered by `ork init`, and a plugin, from the
start; and powers to read, check and start, never to decide.

## Decision

**`ork mcp` is a stdio MCP server on the core functions,** a third client of the
store beside the CLI and `ork ui`. Its reading tools are built from the API's
read routes alone; `check` runs `ork validate`'s checks and walk;
`explain_context` is `ork context explain`; `start_run` is built from the API's
start route alone ([ork mcp](../specs/cli/mcp.md)). No tool answers a decision,
or stops, pauses, resumes or messages a run, and a test holds the list. Every
tool but `start_run` is marked read-only, so Claude Code asks before a start.
Inside a run, marked by `ORK_RUN` or `ORK_SESSION`, there is no `start_run`.
With `--expects`, an older `ork` refuses every call and says to upgrade.

**Three skills,** `write`, `run` and `principles`, live once in
`plugins/ork/skills/`. A test checks every workflow in them as `check` does, and
they never take a run's built-in skill names.

**The repository is a Claude Code marketplace** with two plugins: `ork` (the
skills, `ork mcp` from the person's `PATH` with `--expects` set to the plugin's
version, and a hook that stops `ork decide` in Claude Code's shell), and
`ork-dev`, which is `.ai/` itself. The release binds the CLI's version into both
plugins.

**`ork init --skills`** writes the skills into a project as `ork-<name>`,
stamped with the Ork that wrote them and linked from `.claude/skills`;
`ork doctor` says when they're older than Ork
([Ork for Claude Code](../specs/claude-code.md)).

## Options considered

From RFC-012, in full there, for how `ork mcp` gets its answers: tools that
shell out to `ork … --json` (a process per call, and text to parse); a client of
`ork ui`'s HTTP API (needs it running, and moves its token between processes);
and the chosen one, the same core functions in one process.

## Rationale

Calling the same handlers as `ork ui` and the same checks as `ork validate`
makes the answers agree by construction, with no port, token or second
implementation. Building the tool list from the read routes and one write route
makes "never decide" a property of the code, not a promise; the hook and the
skills add to it for the shell. Answers are cut to what a model needs, which is
Ork's token economy at the engine: the format's schema comes a part at a time,
10 KB instead of 49.

## Consequences

- Claude Code writes workflows that pass first time and splits work the way Ork
  is built to save, in any project with the plugin or `ork init --skills`.
- A third entry point to the core functions, and skill text to keep current with
  each change to the format. The fixture test catches a broken example, not a
  stale explanation.
- A run's own plugin is also named `ork`, and Claude Code merges two plugins of
  one name, which is why `ork mcp` offers no start inside a run and the skills'
  names stay apart from the built-in ones.
- The hook stops accidents, not a determined agent, and needs a `node` that runs
  TypeScript; the plugin needs `ork` on `PATH`
  ([limits L143–L144](../specs/gaps/limits-claude-code.md)).
- Until a release ships `ork mcp`, the plugin's server can't start against the
  published `ork`.
- Other agents (Codex, Cursor) can use `ork mcp` by hand; skills for them are
  not a goal yet.
