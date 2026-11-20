# Agents and knowledge rules

_Part of [Project rules](../project-rules.md)._

Status: **Built**: `rules.agents` and `knowledge`
([project.ts](../../packages/schema/src/project.ts),
[tool-rules.ts](../../packages/core/src/run/tool-rules.ts),
[rules.ts](../../packages/core/src/project/rules.ts),
[apply.ts](../../packages/cli/src/runs/apply.ts),
[tests](../../packages/core/test/rules.test.ts)). Both are off by default. Why:
[ADR-110](../../decisions/ADR-110-keep-ork-sessions-apart.md).

A repository can run its own agent process (a documenter, an implementer, a
reviewer, each a Claude Code agent file) for contributors who never use Ork. Ork
runs those steps as separate nodes, so two keys keep an Ork session from doing a
role's work itself or from writing where the repository's own contributors read.

```yaml
# .ork/project.yaml (or `rules:` in a workflow, for agents)
agents: isolate # open | isolate (default open)
knowledge: ork-only # any | ork-only (default any), the project's alone
```

## `agents`

`open` (the default) leaves sessions as they are. `isolate` denies, in a node's
session, starting as a sub-agent any agent that fills another node of the
workflow:

- For each `agent:` of another node of the workflow that is not an
  `agent.subagent` node, the node's `tools.deny` gets `Agent(<name>)`, and
  `Task(<name>)` beside it, because Claude Code still reads `Task(...)` as an
  alias of `Agent(...)`.
- Never the node's own agent, and never the agents of its own `agent.subagent`
  children: a node may start the sub-agents it owns.
- `<name>` is the workflow's agent key. A repository agent file whose `name:`
  differs from that key is not denied (match by name only,
  [L516](../gaps/session-apart-limits.md)).
- The deny rides in the node's own deny list, so Claude Code lets it win over
  any allow. It is a Claude Code rule: the other drivers may not act on it
  ([L517](../gaps/session-apart-limits.md)).

A workflow's `rules.agents` wins over the project's, as `reading` does. Absent
or `open`: no such deny.

## `knowledge`

`any` (the default) limits nothing. `ork-only` is for a project whose documents,
specs and agent files belong to people who work without Ork: the fix
`ork feedback apply` makes may touch only the project's own Ork folder.

- `ork feedback apply` starts its worker with a write limit on `.ork/`: a Write,
  Edit or NotebookEdit of any other path is refused, and so is any file named
  CLAUDE.md or AGENTS.md, even under `.ork/`
  ([the write limit](../runtime/write-limit.md),
  [closing the loop](../feedback/closing-the-loop.md#a-fix-under-knowledge-ork-only)).
- In an attached project the Ork folder is outside the repository, so the limit
  cannot say where the fix may go, and `ork feedback apply` refuses with the
  rule and the cause ([L521](../gaps/session-apart-limits.md)).
- It is the project's alone: a workflow's `rules:` does not carry it, and
  `ork validate` refuses an unknown value.
- Only `ork feedback apply` sets the limit. Other workflows are not held to it
  ([L520](../gaps/session-apart-limits.md)).

## Withheld in every session

Whatever these rules say, a Claude session's `tools.deny` carries
`AskUserQuestion` (its prompt would wait for no one in a headless session; the
session asks through `ask_user`), unless the node's `tools.allow` or
`tools.only` names it
([session text](../context/session-apart.md#session-text)).
