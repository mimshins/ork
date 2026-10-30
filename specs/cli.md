# The ork CLI

Status: **Partial**: `ork init`, `ork validate`, `ork doctor`, `ork run` (a
whole workflow, or one node with `--node`), `ork worktrees` and
`ork context explain` are built ([code](../packages/cli/src/main.ts),
[tests](../packages/cli/test/cli.test.ts),
[run tests](../packages/cli/test/run.test.ts)); the other commands are
specified. Published as `@krapht/ork`
([release](../runbook/development/release.md),
[ADR-015](../decisions/ADR-015-changesets-and-one-bundled-cli.md)).

```
ork init                         # scaffold .ork/, .gitignore entries, example workflow
ork doctor                       # node, git, every Claude driver and integration (its own login check)
ork validate <wf>                # schema, graph and skill/context references; errors with yaml line numbers
ork run <wf> [--input k=v] [--driver sdk|cli] [--in-place] [--allow-dirty] [--json] [--detach]
ork run <wf> --node <id> [--input k=v] [--driver sdk|cli] [--in-place] [--json]
ork ps / ork logs <run> [--node n] [--follow]
ork tree <run>                   # live ownership tree with status, tokens, $ per node
ork decide [<run>]               # answer pending decisions
ork chat <run> <node>
ork stop|resume <run>
ork worktrees [list|clean]       # Ork's worktrees and branches; clean them up safely
ork context explain <wf> <node> [--json]  # what one node's session loads, layer by layer
ork feedback [list|show|dismiss] # local feedback items (triage, apply, lesson, publish: M2)
ork ui [--port 4417]             # milestone 2
```

## Running a workflow

`ork run <wf>` runs the whole workflow through the [scheduler](./scheduler.md)
with the built-in node types
([workflow.ts](../packages/cli/src/run/workflow.ts)):

- The workflow and its inputs are checked as for `--node`; nothing starts on an
  error.
- `worktree` Claude nodes get their own worktree beside the clone, and the run
  first checks the project ([worktrees](./worktrees.md#before-the-run)):
  uncommitted instructions or skills stop it unless `--allow-dirty`.
  `--in-place` runs every node in this checkout instead.
- stdout gets one transcript line per event, prefixed with the node id
  (`builder │ …`): each start (with its round), session text and tool calls,
  each result (`✓ pass: …`, `✓ exit 0`, `✓ merge (user)`), skips and exhausted
  loops, and worktree changes (`⎇ created …`, `merged`, `removed`); then the run
  summary: status, total cost, how many nodes ran and were skipped, the
  worktrees left for you (branch, path, why), and the reasons it did not
  succeed. `--json` prints the [run events](./scheduler.md#run-events) as JSON
  lines.
- Tool nodes run as declared (their `allow` list is checked first); gates and
  questions use the terminal channel below.
- Exit code 0 when the run succeeded, 1 otherwise. Ctrl-C interrupts the run.
- `--detach` waits for the event store (M1d).

## Running one node

`ork run <wf> --node <id>` runs one Claude node on its own
([run.ts](../packages/cli/src/commands/run.ts)):

- `<wf>` is a path, or the name of a workflow in `.ork/workflows/` (`hello` is
  `.ork/workflows/hello.ork.yaml`).
- The workflow must validate, `--input name=value` (repeatable) must satisfy its
  inputs, and the node must be a `claude.leader` or `claude.worker`. Nothing
  starts otherwise; the errors go to stderr and the exit code is 1.
- The session spec comes from `planNodeSession`
  ([plan.ts](../packages/core/src/run/plan.ts)). A brief that reads
  `{{nodes.*}}` renders empty and prints a warning. A run of one node sets up no
  worktree, so a `worktree` node needs `--in-place`; `readonly` denies the write
  tools.
- `--driver` overrides the node's and the workflow's driver. The drivers load
  only when a run starts.
- stdout gets the transcript (session start, assistant text, one line per tool
  call, failed tool results) and then the report: status, summary, branch,
  artifacts, the `output.schema` fields, and usage (cost, tokens, turns, time).
  `--json` prints the runtime events as JSON lines instead.
- Exit code 0 when the node reports `pass`, `done` or `changes_requested`; 1 on
  `fail` or no valid report. Ctrl-C interrupts the session.

### Questions and permissions on the terminal

The CLI's `HumanChannel` ([human.ts](../packages/cli/src/human.ts)) prompts on
stderr, one prompt at a time, until the decision queue (M1d) replaces it:

- `ask_user` lists the options with the recommended one marked; Enter takes the
  recommended option, and a number or an option id picks one. An invalid answer
  asks again.
- A permission prompt shows the tool and a one-line preview of its input and
  asks `Allow? [y/N]`; anything but `y` denies it.
- Without a terminal (stdin is not a TTY), tools are denied and a question gets
  the recommended option, or tells the node to use its judgment and say so in
  its report.

## Worktrees

`ork worktrees` lists and cleans the worktrees and `ork/` branches runs leave;
see [Worktrees: ork worktrees](./worktrees.md#ork-worktrees).

## Context

`ork context explain <wf> <node>` plans the node's session without running or
writing anything and prints what it loads
([context](./context.md#how-a-nodes-session-is-compiled)):

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
([ADR-022](../decisions/ADR-022-integration-registry.md)): installed, and signed
in with the user's own login, never printing a token or an account. At least one
driver must be ready; integrations are optional. The CLI driver's check warns
when `claude` is older than 2.1.281, which Ork needs to read `AGENTS.md`
([context](./context.md#how-a-nodes-session-is-compiled)).
