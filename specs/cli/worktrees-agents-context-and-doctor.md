# Worktrees, agents, context and doctor

_Part of [The ork CLI](../cli.md)._

## Projects

`ork register` attaches a project from outside its repository, `ork init`
records an in-repo one, and `ork projects` lists them or forgets one (`--ids`
prints the project ids on one line, `--limit n` keeps the first N, `--json`
prints them; it has no fields to filter by, [list filters](./list-filters.md));
see [Projects](../projects.md#registering). `ork migrate` moves an attached
project into `.ork/`, brings agents and skills under it (`--agents`), or drafts
a workflow from the project's agents (`--from-agents`); see
[Projects: migrating](../projects.md#migrating). A workflow given by name is
found in the current folder's project: `.ork/workflows/`, or the attached
project's `workflows/`.

`ork init` writes the starter workflow, `.ork/workflows/hello.ork.yaml`, which
names no driver: it is committed, and a run takes the driver ready on the
machine running it ([runtime](../runtime.md#which-driver-a-session-uses)).
`ork init` says in one line which that is here, from [doctor](#doctor)'s own
checks (the same checks, not a copy):
`Runs use the driver that's ready when they start: claude-code here (…).` When
`.ork/project.yaml` names a `defaults.driver`, it says that one instead, and
runs no check. With none ready, it passes on the claude-code driver's hint
(install Claude Code, `claude auth login`, or an API key or cloud provider). A
starter that is already there is left as it is, and nothing is said or checked
([code](../../packages/cli/src/project/init.ts)). In a git repository with no
commit, `ork init` still writes everything and exits 0, then warns that worktree
runs branch from `HEAD`, so a first commit is needed. When `ork init` writes the
`issues` workflow (`--issues`), it also says which driver that workflow runs on
and whether it is ready here:
`issues runs on claude-code (its model, claude-code.sonnet): <ready detail | not ready: hint>`.
The driver and model come from the bundled workflow's `defaults.model`, and
readiness from the same driver checks; a file that is already there is left
alone and says nothing.

## Worktrees

`ork worktrees` lists, cleans and removes the worktrees and branches runs
recorded creating, whatever the project's [rules](../project-rules.md) named
them, and lists (but never cleans or removes) any `ork/` branch no run recorded,
marked "not created by Ork"; `clean --force` shows what it would lose and
`--run` takes a run of the project; see
[Worktrees: ork worktrees](../worktrees.md#ork-worktrees).

`ork worktrees list` filters as every list does
([list filters](./list-filters.md)): `--run <run>` (an id or a unique start of
one; an unknown run is refused) keeps one run's worktrees, `--project <id>|all`
takes a registered project's id or root, or every project's (default: the one
you are in), `--limit n` keeps the first N, `--ids` prints what
`ork worktrees remove` takes (the branch, or the path for one with none),
comma-separated on one line, and `--json` prints them. `clean`'s own `--run` and
`--all` are unchanged.

## Agents

`ork agents` manages the agents nodes can take
([context](../context.md#agents)):

- `list` prints every agent: name, source (`user`, `project`), its file, the
  linked folders it was reached through, and what shadows it. Invalid agent
  files are reported on stderr and skipped. `--source builtin|user|project`
  keeps the agents from one source, `--limit n` the first N, `--ids` prints the
  names on one line, and `--json` prints them
  ([list filters](./list-filters.md)).
- `show <name>` prints the winning agent: description, source and hash,
  settings, and role.
- `add <name>` writes `.ork/agents/<name>.md` (and `<name>.agent.yaml` when it
  has settings), or `~/.ork/agents/` with `--user`. A new agent's role is "You
  are <name>." plus its description, for the user to edit; `--from <agent>`
  copies one the user or project already has, which the copy then shadows. It
  never overwrites.
- `rm <name>` removes an agent from `.ork/agents/` (or `~/.ork/agents/` with
  `--user`). A project's tool folders (`.claude/agents`, …) are never written.

## Linking tool folders

`ork link [tools…]` makes `.ork/agents` and `.ork/skills` the origin other tools
read ([ADR-031](../../decisions/ADR-031-ork-is-the-origin.md)): each named
tool's agents and skills folders, from the layout registry (`claude`, `agents`,
`opencode`, `ai`), become relative links to them.

- In an attached project it links nothing and says so, and `ork doctor` skips
  the link checks: Ork writes nothing into its repository.
- With no tools named, it links the tools the project already uses: those whose
  top folder (`.claude`, `.opencode`, …) exists. With none, it says so and
  changes nothing.
- It only creates. A folder that is missing becomes a link; a real folder, or a
  link to somewhere else, is printed as `kept` and left as it is. A link to a
  missing `.ork/` folder gets the folder back.
- An origin folder it creates gets a `.gitkeep`, so committed links never dangle
  in a fresh clone.
- `--check` prints each folder's state (`ok`, `missing`, `broken`, `kept`) and
  changes nothing. An unknown tool fails, naming the known ones.

`ork init` links the tools a project already uses the same way; `--no-link`
skips it.

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
JSON. The planning is core's `explainSession`
([explain.ts](../../packages/core/src/run/explain.ts)), which `ork mcp`'s
`explain_context` uses too; with `texts` it adds each piece's words, which these
two leave out. A worker spawned in a run (`<template>-<n>`) is planned as the
node it came from.

## Doctor

`ork doctor` first shows Ork's own version against the last update check
([updates](./updates.md#the-new-version-notice)), then checks Node and git (a
repository with no commit is a warning, `git commits`, never a failure: worktree
runs need a `HEAD`), then runs each registered agent driver's and integration's
own check ([ADR-022](../../decisions/ADR-022-integration-registry.md)):
installed, and signed in with the user's own login, never printing a token or an
account. At least one driver must be ready; integrations are optional. The
claude-code driver is ready when `claude` is logged in, or `ANTHROPIC_API_KEY`
or `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY=1` is set, and its detail says
which; it warns when `claude` is older than 2.1.281, which Ork needs to read
`AGENTS.md` ([context](../context.md#how-a-nodes-session-is-compiled)). The
drivers `open-code` and `command-code` are checked with `opencode --version` and
`cmd --version`: `ok` when the tool answers (their logins, `opencode auth login`
and `cmd login`, are named, never read), `skip` with how to install it when it
is missing. A driver whose descriptor is not `proven` is listed as `skip` with
"unproven", and never counts as a ready driver.

Once a project has `.ork/`, doctor adds one check per tool the project uses:
`ok` when its folders link to `.ork/`, a warning when one is missing or broken
(with `ork link <tool>` as the fix), and `skip` when the project keeps its own
folder or links elsewhere. These checks never fail the doctor. It also warns
when the project's copies of Ork's skills for Claude Code are older than Ork,
with `ork init --skills` as the fix ([Ork for Claude Code](../claude-code.md)).

A `command-code` line appears only when a Command Code session stopped without
removing its `ork` MCP entry (a crash): doctor removes it from the checkout's
local scope, leaving the user's other entries, and says where (`ok`), or warns
with `cmd mcp remove --scope local ork` as the fix when it can't. It reads the
lease records in the project's runs folder
([architecture](../architecture/command-code.md)).

A ledger check
([ledger-checks.ts](../../packages/cli/src/doctor/ledger-checks.ts)) sweeps the
stale records and tickets of processes that are gone from the machine's
heavy-command slots (`~/.ork/slots`) and its locks (`~/.ork/locks`), and names
each one it removed (`run/node (pid …)`). It is silent when there are none, and
never fails the doctor ([machine](../machine.md#slots),
[integration](../integration.md#the-ledger)).

A `sockets` check warns when the longest run socket path under `~`
(`~/.ork/sockets/node-<8>.sock`) is past what the system allows (103 bytes on
macOS, 107 on Linux): runs still work, but answers, commands and followers wait
on the store, up to a second each
([messaging](../messaging.md#reaching-a-live-run)). It never fails the doctor.

An `experiments` line lists each [experiment](../project-rules.md#experiments)
that is on and where it was turned on (`one (project file)`,
`two (environment)`, or both), or `none on`, in every project and outside one.
It prints names only. An unknown name, from either source, fails that check,
named with its source and the known names, and `ork doctor` exits non-zero; the
other checks still run.
