# The ork CLI

Status: **Partial**: `ork init`, `ork link`, `ork validate`, `ork doctor`,
`ork run` (a whole workflow, or one node with `--node`), `ork ps`, `ork logs`,
`ork tree`, `ork decide`, `ork stop`, `ork chat`, `ork resume`, `ork worktrees`,
`ork context explain`, `ork agents list | show | add | rm` and
`ork feedback list | show | dismiss` ([feedback](./feedback.md)) are built
([code](../packages/cli/src/main.ts), [tests](../packages/cli/test/cli.test.ts),
[run tests](../packages/cli/test/run.test.ts),
[agents tests](../packages/cli/test/agents.test.ts),
[link tests](../packages/core/test/links.test.ts)); the other commands are
specified. Published as `@krapht/ork`
([release](../runbook/development/release.md),
[ADR-015](../decisions/ADR-015-changesets-and-one-bundled-cli.md)).

```
ork init [--no-link]             # scaffold .ork/, .gitignore entries, example workflow; link tool folders
ork link [tools…] [--check]      # point tools' agents and skills folders (.claude/agents, …) at .ork/
ork doctor                       # node, git, every Claude driver and integration (its own login check), links
ork validate <wf>                # schema, graph, project rules, agents and skill/context references; errors with yaml line numbers
ork agents list [--json] | show <name> [--json]   # the agents nodes can take, and where each comes from
ork agents add <name> [--description d] [--model m] [--from <agent>] [--user] | rm <name> [--user]
ork run <wf> [--input k=v] [--driver sdk|cli] [--in-place] [--allow-dirty] [--json] [--detach]
ork run <wf> --node <id> [--input k=v] [--driver sdk|cli] [--in-place] [--json]
ork ps [--all] [--limit n] [--json]               # this project's runs, newest first
ork logs [<run>] [--node n] [--follow] [--json]   # a run's transcript, replayed or live
ork tree [<run>] [--json]        # ownership tree with status, tokens, $ per node
ork decide [<run>] [--all] [--list] [--json] [--id <d> --choose <option>]  # answer open decisions
ork chat <run> <node> [-m <text>] [--driver sdk|cli]  # talk to a node, live or by resuming its session
ork stop [<run>]                 # stop a live run from any terminal
ork resume [<run>] [--input k=v] [--driver sdk|cli] [--in-place] [--allow-dirty] [--json]  # continue a stopped or crashed run
ork worktrees [list|clean]       # Ork's worktrees and branches; clean them up safely
ork context explain <wf> <node> [--json]  # what one node's session loads, layer by layer
ork feedback list [--all] [--json] | show <item> [--json] | dismiss <item>  # local feedback items (triage, apply, lesson, publish: M2)
ork ui [--port 4417]             # milestone 2
```

## Contents

- [Running and runs](./cli/running-and-runs.md)
  - [Running a workflow](./cli/running-and-runs.md#running-a-workflow)
  - [Running one node](./cli/running-and-runs.md#running-one-node)
    - [Questions and permissions on the terminal](./cli/running-and-runs.md#questions-and-permissions-on-the-terminal)
  - [Runs](./cli/running-and-runs.md#runs)
  - [Decisions and stopping](./cli/running-and-runs.md#decisions-and-stopping)
  - [Resuming a run](./cli/running-and-runs.md#resuming-a-run)
- [Worktrees, agents, context and doctor](./cli/worktrees-agents-context-and-doctor.md)
  - [Worktrees](./cli/worktrees-agents-context-and-doctor.md#worktrees)
  - [Agents](./cli/worktrees-agents-context-and-doctor.md#agents)
  - [Linking tool folders](./cli/worktrees-agents-context-and-doctor.md#linking-tool-folders)
  - [Context](./cli/worktrees-agents-context-and-doctor.md#context)
  - [Doctor](./cli/worktrees-agents-context-and-doctor.md#doctor)
