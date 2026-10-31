# Worktrees, agents, context and doctor

_Part of [The ork CLI](../cli.md)._

## Worktrees

`ork worktrees` lists and cleans the worktrees and `ork/` branches runs leave;
see [Worktrees: ork worktrees](../worktrees.md#ork-worktrees).

## Agents

`ork agents` manages the agents nodes can take
([context](../context.md#agents)):

- `list` prints every agent: name, source (`user`, `project`), its file, the
  linked folders it was reached through, and what shadows it. Invalid agent
  files are reported on stderr and skipped.
- `show <name>` prints the winning agent: description, source and hash,
  settings, and role.
- `add <name>` writes `.ork/agents/<name>.md` (and `<name>.agent.yaml` when it
  has settings), or `~/.ork/agents/` with `--user`. A new agent's role is "You
  are <name>." plus its description, for the user to edit; `--from <agent>`
  copies one the user or project already has, which the copy then shadows. It
  never overwrites.
- `rm <name>` removes an agent from `.ork/agents/` (or `~/.ork/agents/` with
  `--user`). A project's tool folders (`.claude/agents`, …) are never written.

## Context

`ork context explain <wf> <node>` (a path, or a workflow name as for `ork run`)
plans the node's session without running or writing anything and prints what it
loads ([context](../context.md#how-a-nodes-session-is-compiled)):

- the agent that fills the node, its file and the estimated tokens of its role;
- the project instructions Claude Code reads (`CLAUDE.md`, `AGENTS.md`, or none;
  or left out by `project.instructions: ignore`);
- every skill, with its layer (user, project, workflow, node), its folder, and
  whether it is live (as `ork:<name>` when Ork loads it) or off, and why
  (shadowed by a higher layer, or left out by `project.skills`), with the
  estimated tokens of its `SKILL.md`, loaded when it is used;
- the context files, by layer, and the practices, with estimated tokens;
- the estimated size of everything appended to Claude Code's system prompt.

Tokens are estimated at about four characters each. `--json` prints the same as
JSON.

## Doctor

`ork doctor` checks Node and git, then runs each registered Claude driver's and
integration's own check
([ADR-022](../../decisions/ADR-022-integration-registry.md)): installed, and
signed in with the user's own login, never printing a token or an account. At
least one driver must be ready; integrations are optional. The CLI driver's
check warns when `claude` is older than 2.1.281, which Ork needs to read
`AGENTS.md` ([context](../context.md#how-a-nodes-session-is-compiled)).
