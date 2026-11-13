# The ork CLI

Status: **Built**: every command below. `ork init`, `ork register`,
`ork projects`, `ork migrate` (with `--from-agents`), `ork link`,
`ork validate`, `ork doctor`, `ork run` (a whole workflow, or one node with
`--node`), `ork ps`, `ork logs`, `ork attach`, `ork tree`, `ork usage` and
`ork prune` ([usage](./usage.md)), `ork decide`, `ork chat`, `ork relay`
([links](./messaging/links.md)), `ork stop`, `ork pause`, `ork continue`
([run control](./run-control.md)), `ork resume`, `ork watch`
([watching](./scheduler/watching.md)), `ork worktrees` (`ork wt`),
`ork context explain`, `ork agents list | show | add | rm`,
`ork feedback list | show | note | dismiss | restore | accept | apply | triage | split | publish | export | import`
([feedback](./feedback.md)),
`ork follow-ups list | show | add | done | drop | reopen | due | post | published`
([follow-ups](./follow-ups/surfaces.md#the-cli)), `ork upgrade` and the
new-version notice ([updates](./cli/updates.md)), `ork ui`
([server](./server.md)), `ork mcp` ([mcp](./cli/mcp.md)),
`ork completion zsh|bash|fish` and the hidden `ork __complete`
([completion](./cli/completion.md)), `ork once` ([check once](./check-once.md)),
and `ork send`, which a tool node's program runs
([scripts](./messaging/scripts.md#ork-send))
([code](../packages/cli/src/main.ts), [tests](../packages/cli/test/cli.test.ts),
[run tests](../packages/cli/test/run.test.ts),
[attach tests](../packages/cli/test/attach-command.test.ts),
[agents tests](../packages/cli/test/agents.test.ts),
[link tests](../packages/core/test/links.test.ts),
[projects tests](../packages/cli/test/projects.test.ts),
[migrate tests](../packages/cli/test/migrate.test.ts),
[usage tests](../packages/cli/test/usage.test.ts),
[prune tests](../packages/core/test/prune.test.ts),
[relay tests](../packages/cli/test/relay.test.ts),
[watch tests](../packages/cli/test/watch.test.ts),
[send tests](../packages/cli/test/send.test.ts),
[init driver tests](../packages/cli/test/init-driver.test.ts),
[ready driver tests](../packages/cli/test/ready-driver.test.ts),
[help tests](../packages/cli/test/help.test.ts),
[list flag tests](../packages/cli/test/list-flags.test.ts)). The terminal kit,
the global `--plain` flag, and the commands that print or ask through the kit
(every one that asked or listed) are built ([terminal](./cli/terminal.md)).
`--help` leaves out the flags only Ork passes to itself (their descriptions
start `Internal:`), and `ork --help` lists the commands in groups
([completion and help](./cli/completion.md#ork---help)). Published as
`@krapht/ork` ([release](../runbook/development/release.md),
[ADR-015](../decisions/ADR-015-changesets-and-one-bundled-cli.md)).

Every command takes `--plain` (or `ORK_PLAIN=1`): no color, no redrawn prompts
([terminal](./cli/terminal.md)).

Every command that lists (`ps`, `usage`, `decide --list`, `follow-ups list`,
`feedback list`, `worktrees list`, `agents list`, `projects`, and `logs` for
time) filters by one field table, with the same `--status`, `--project`,
`--since`, `--until`, `--ids`, `--limit` and `--json`. A list refuses a flag it
does not have, and the old `--all` of five of them is gone (`--project all` or
`--status all`); an argument error on any command with no subcommands prints one
line, not the help ([list filters](./cli/list-filters.md)). `ork mcp`'s list
tools check `project` and `limit` in the same words.

```
ork init [--no-link] [--skills] [--issues]  # scaffold .ork/, .gitignore entries, a starter workflow that names no driver; link tool folders; record the project; Ork's skills for Claude Code; the issues workflow
ork register [path] [--id <id>] [--json]  # attach a project from outside: its files in ~/.ork/projects/<id>/, nothing in the repo
ork projects [--limit n] [--ids] [--json] | forget <id> | move <id> <path>  # the registered projects; follow a moved clone
ork migrate [--agents] [--dry-run] [--yes]  # attached → .ork/; --agents: agents and skills under .ork/, tool folders relinked; renames old `claude.*` node types to `agent.*` in the project's workflows; commits nothing
ork migrate --from-agents a,b [--reviewer r] [--name n]  # draft a gated workflow from the project's agents
ork link [tools…] [--check]      # point tools' agents and skills folders (.claude/agents, …) at .ork/
ork doctor                       # node, git (and a first commit), every agent driver and integration (its own login check), links
ork validate [<wf>…] [--paths] [--json] [--driver <id>]   # schema, graph, project rules, agents and skill/context references, with yaml line numbers, then a walk of every way through; `--paths` lists each ending (the walk line points to it); with no file, the project's triggers too; each session node is checked against its driver (`--driver`, else the one a run would take; [driver fit](./graph-compiler.md#driver-fit))
ork agents list [--source builtin|user|project] [--limit n] [--ids] [--json] | show <name> [--json]   # the agents nodes can take, and where each comes from
ork agents add <name> [--description d] [--model m] [--from <agent>] [--user] | rm <name> [--user]
ork run <wf> [--input k=v] [--driver <id>] [--in-place] [--allow-dirty] [--json] [--detach] [--verbose]  # <wf>: a file, a name in .ork/workflows/, or ork:<name>
ork run <wf> --follow-ups <ids|due>  # take open agent follow-ups (ids, or `due` for every due one) as the run's `brief` input; done when it publishes
ork run <wf> --node <id> [--input k=v] [--driver <id>] [--in-place] [--json] [--verbose]
ork ps [--status s] [--workflow w] [--project p|all] [--since 7d] [--until day] [--limit n] [--ids] [--json]  # this project's runs, newest first; 20 by default
ork logs [<run>] [--node n] [--since t] [--until day] [--limit n] [--follow] [--json] [--verbose]   # a run's transcript, replayed or live
ork attach <run>                 # follow a run and the runs it called, and answer their questions here; Ctrl-C detaches ([run control](./run-control.md#detaching-from-a-run))
ork tree [<run>] [--json]        # ownership tree with status, tokens, $ per node; a delegated node's task description after its id
ork usage [--project p|all] [--since 30d|day|all] [--until day] [--by day|workflow|model|…] [--workflow w] [--json]  # what runs spent over time
ork prune --older-than 90d [--all] [--dry-run] [--yes]  # forget old runs' logs; what they spent stays
ork decide [<run>] [--project p|all] [--list] [--ids] [--limit n] [--json] [--workflow <name>] [--id <d> --document] [--id <d> --choose <option> [--say <text>] [--note <text>] [--rating good|bad]] [--verbose]  # answer open decisions (a card with arrow keys on a terminal; --verbose shows each question's whole context); --say gives the answer a note for the run, --note notes the decision's node as feedback
ork chat <run> <node> [-m <text>] [--driver <id>]  # talk to a node, live or by resuming its session
ork relay <run>/<node> <run>/<node> [--max-messages n]  # let two running nodes of different runs message each other
ork relay end <a> <b> | ork relay list [run] [--all] [--json]  # ended ones too
ork once [--as <name>] [--covers <name>]… [--with-head] [--force] -- <command…>  # run a command unless the same check already passed on these files ([check once](./check-once.md))
ork stop [<run>] [--node n]      # stop a live run from any terminal, or one node (it fails; the run goes on)
ork pause [<run>] [--node n]     # nothing new starts; sessions wait before their next tool call
ork continue [<run>] [--node n]  # let a paused run, or one paused node, go on
ork resume [<run>] [--input k=v] [--driver <id>] [--in-place] [--allow-dirty] [--json] [--detach]  # continue a run that didn't succeed
ork watch [--detach] | --status | --accept | --stop  # look at each project's triggers, and start a run for each new thing
ork worktrees [list [--run r] [--project p|all] [--limit n] [--ids] [--json]|clean|remove <branch|path>]  # Ork's worktrees and branches; clean them up, or remove one, safely
ork context explain <wf> <node> [--json]  # what one node's session loads, layer by layer
ork feedback list [--status s|all] [--kind k] [--severity s] [--workflow w] [--run r] [--limit n] [--ids] [--json] | show <item> [--json] | note <run> [<node>] -m <text> | dismiss <item> | restore <item>  # local feedback
ork feedback accept <item> [--lesson [-m <text>] [--workflow <w>]]  # accept an item; --lesson: every later session of its workflow reads it
ork feedback apply <item> [--driver <id>]  # Ork's own workflow proposes a fix on a branch; keep or discard it
ork feedback triage [--yes] | split <item>   # merge items about the same problem, by rules, asking each time; split one back
ork feedback publish <item> [--hide-names]   # share an item about Ork with its maintainers: redacted, previewed, then y/N, with your own gh
ork feedback export [--all] [-o <file>] | import <file>  # move feedback records as JSON lines
ork follow-ups list [--status s|all] [--for <for>] [--kind k] [--due d] [--project p|all] [--limit n] [--ids] [--json] | show <id> | add <title> [--for --kind --due --body --where --ref --to --channel --text --step]  # what shipped changes left for later
ork follow-ups done <id> | drop <id> | reopen <id> | due <id|run> | post <id> --confirm | published <ref>  # close, drop, bring back, make due, post a github draft, record a publish
ork upgrade [--check] [--yes]    # a newer version? upgrade the way Ork was installed, after asking
ork ui [--port <n>] [--no-open]  # the local server (127.0.0.1:4417) and its page; opens the running one
ork mcp [--expects <version>]    # Ork's tools for Claude Code over stdio (MCP): read, check, start; never decide
ork completion zsh|bash|fish     # print a tab-completion script; the script runs the hidden `ork __complete -- <words…>`
```

## Contents

- [Running and runs](./cli/running-and-runs.md)
  - [Running a workflow](./cli/running-and-runs.md#running-a-workflow)
  - [Running one node](./cli/running-and-runs.md#running-one-node)
    - [Questions and permissions on the terminal](./cli/running-and-runs.md#questions-and-permissions-on-the-terminal)
  - [Runs](./cli/running-and-runs.md#runs)
  - [Decisions and stopping](./cli/running-and-runs.md#decisions-and-stopping)
  - [Resuming a run](./cli/running-and-runs.md#resuming-a-run)
- [The terminal kit and `--plain`](./cli/terminal.md)
  - [Mode](./cli/terminal.md#mode)
  - [Look](./cli/terminal.md#look)
  - [Prompts](./cli/terminal.md#prompts)
  - [Limits](./cli/terminal.md#limits)
- [Worktrees, agents, context and doctor](./cli/worktrees-agents-context-and-doctor.md)
  - [Projects](./cli/worktrees-agents-context-and-doctor.md#projects)
  - [Worktrees](./cli/worktrees-agents-context-and-doctor.md#worktrees)
  - [Agents](./cli/worktrees-agents-context-and-doctor.md#agents)
  - [Linking tool folders](./cli/worktrees-agents-context-and-doctor.md#linking-tool-folders)
  - [Context](./cli/worktrees-agents-context-and-doctor.md#context)
  - [Doctor](./cli/worktrees-agents-context-and-doctor.md#doctor)
- [ork mcp](./cli/mcp.md)
  - [Tools](./cli/mcp.md#tools)
- [Updates](./cli/updates.md)
  - [The new-version notice](./cli/updates.md#the-new-version-notice)
  - [ork upgrade](./cli/updates.md#ork-upgrade)
  - [In ork ui](./cli/updates.md#in-ork-ui)
- [Limits: upgrading from the browser view](./cli/upgrade-limits.md)
- [List filters](./cli/list-filters.md)
  - [The table](./cli/list-filters.md#the-table)
  - [Field types](./cli/list-filters.md#field-types)
  - [Flags every list takes](./cli/list-filters.md#flags-every-list-takes)
  - [Order and defaults](./cli/list-filters.md#order-and-defaults)
  - [Refusals](./cli/list-filters.md#refusals)
  - [The lists](./cli/list-filters.md#the-lists)
- [Completion and help](./cli/completion.md)
  - [The command tree](./cli/completion.md#the-command-tree)
  - [ork completion](./cli/completion.md#ork-completion)
  - [Answering the shell](./cli/completion.md#answering-the-shell)
    - [Values](./cli/completion.md#values)
    - [What it reads](./cli/completion.md#what-it-reads)
  - [ork --help](./cli/completion.md#ork---help)
