# The ork CLI

Status: **Partial**: `ork init`, `ork register`, `ork projects`, `ork migrate`,
`ork link`, `ork validate`, `ork doctor`, `ork run` (a whole workflow, or one
node with `--node`), `ork ps`, `ork logs`, `ork tree`, `ork decide`, `ork stop`,
`ork pause`, `ork continue` ([run control](./run-control.md)), `ork chat`,
`ork resume`, `ork worktrees`, `ork context explain`,
`ork agents list | show | add | rm`,
`ork feedback list | show | note | dismiss | restore`
([feedback](./feedback.md)), `ork upgrade` and the new-version notice
([updates](./cli/updates.md)), and `ork ui` ([server](./server.md)) are built
([code](../packages/cli/src/main.ts), [tests](../packages/cli/test/cli.test.ts),
[run tests](../packages/cli/test/run.test.ts),
[agents tests](../packages/cli/test/agents.test.ts),
[link tests](../packages/core/test/links.test.ts),
[projects tests](../packages/cli/test/projects.test.ts),
[migrate tests](../packages/cli/test/migrate.test.ts)); the other commands are
specified. Published as `@krapht/ork`
([release](../runbook/development/release.md),
[ADR-015](../decisions/ADR-015-changesets-and-one-bundled-cli.md)).

```
ork init [--no-link]             # scaffold .ork/, .gitignore entries, example workflow; link tool folders; record the project
ork register [path] [--id <id>] [--json]  # attach a project from outside: its files in ~/.ork/projects/<id>/, nothing in the repo
ork projects [--json] | forget <id> | move <id> <path>  # the registered projects; follow a moved clone
ork migrate [--agents] [--dry-run] [--yes]  # attached → .ork/; --agents: agents and skills under .ork/, tool folders relinked; commits nothing
ork migrate --from-agents a,b [--reviewer r] [--name n]  # draft a gated workflow from the project's agents
ork link [tools…] [--check]      # point tools' agents and skills folders (.claude/agents, …) at .ork/
ork doctor                       # node, git, every Claude driver and integration (its own login check), links
ork validate <wf> [--paths] [--json]   # schema, graph, project rules, agents and skill/context references, with yaml line numbers, then a walk of every way through; `--paths` lists each ending; with no file, the project's triggers too
ork agents list [--json] | show <name> [--json]   # the agents nodes can take, and where each comes from
ork agents add <name> [--description d] [--model m] [--from <agent>] [--user] | rm <name> [--user]
ork run <wf> [--input k=v] [--driver sdk|cli] [--in-place] [--allow-dirty] [--json] [--detach]
ork run <wf> --node <id> [--input k=v] [--driver sdk|cli] [--in-place] [--json]
ork ps [--all] [--limit n] [--json]               # this project's runs, newest first
ork logs [<run>] [--node n] [--follow] [--json]   # a run's transcript, replayed or live
ork tree [<run>] [--json]        # ownership tree with status, tokens, $ per node
ork usage [--all] [--since 30d] [--until day] [--by day|workflow|model|…] [--workflow w] [--json]  # what runs spent over time
ork prune --older-than 90d [--all] [--dry-run] [--yes]  # forget old runs' logs; what they spent stays
ork decide [<run>] [--all] [--list] [--json] [--id <d> --choose <option>]  # answer open decisions
ork chat <run> <node> [-m <text>] [--driver sdk|cli]  # talk to a node, live or by resuming its session
ork relay <run>/<node> <run>/<node> [--max-messages n]  # let two running nodes of different runs message each other
ork relay end <a> <b> | ork relay list [run] [--all] [--json]
ork stop [<run>] [--node n]      # stop a live run from any terminal, or one node (it fails; the run goes on)
ork pause [<run>] [--node n]     # nothing new starts; sessions wait before their next tool call
ork continue [<run>] [--node n]  # let a paused run, or one paused node, go on
ork resume [<run>] [--input k=v] [--driver sdk|cli] [--in-place] [--allow-dirty] [--json] [--detach]  # continue a stopped or crashed run
ork watch [--detach] | --status | --accept | --stop  # look at each project's triggers, and start a run for each new thing
ork worktrees [list|clean]       # Ork's worktrees and branches; clean them up safely
ork context explain <wf> <node> [--json]  # what one node's session loads, layer by layer
ork feedback list [--all] [--json] | show <item> [--json] | note <run> [<node>] -m <text> | dismiss <item> | restore <item>  # local feedback (triage, apply, lessons, publish: M2)
ork upgrade [--check] [--yes]    # a newer version? upgrade the way Ork was installed, after asking
ork ui [--port <n>] [--no-open]  # the local server (127.0.0.1:4417) and its page; opens the running one
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
  - [Projects](./cli/worktrees-agents-context-and-doctor.md#projects)
  - [Worktrees](./cli/worktrees-agents-context-and-doctor.md#worktrees)
  - [Agents](./cli/worktrees-agents-context-and-doctor.md#agents)
  - [Linking tool folders](./cli/worktrees-agents-context-and-doctor.md#linking-tool-folders)
  - [Context](./cli/worktrees-agents-context-and-doctor.md#context)
  - [Doctor](./cli/worktrees-agents-context-and-doctor.md#doctor)
- [Updates](./cli/updates.md)
  - [The new-version notice](./cli/updates.md#the-new-version-notice)
  - [ork upgrade](./cli/updates.md#ork-upgrade)
