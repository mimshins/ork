# Watching a source

_Part of [The scheduler](../scheduler.md)._

Status: **Built** ([ADR-053](../../decisions/ADR-053-watching-a-source.md),
[RFC-011](../../rfcs/archived/RFC-011-watching-a-source.md)).

A look at a source is a deterministic program with no model turn. Inside a run,
`watch:` repeats it until a condition holds. Outside one,
[`ork watch`](#triggers) repeats it and starts a run for each new thing it
reports.

## Contents

- [`watch:` on a node](#watch-on-a-node)
- [Triggers](#triggers)
  - [The file](#the-file)
  - [The guards](#the-guards)
  - [Trust](#trust)
  - [Inputs from a source](#inputs-from-a-source)
  - [The process](#the-process)

## `watch:` on a node

Tool nodes and `mcp.call` take `watch: { every, until, timeout, misses? }`
([run/watch.ts](../../packages/core/src/run/watch.ts)):

- `every`, at least `5s`, is the wait between looks. `timeout` must be longer.
  All three of `every`, `until` and `timeout` are required, so a wait can't be
  endless by leaving one out.
- `until` reads what an edge's `when:` does, and is checked by the same
  reference checks. These would never end the wait, so each is an error
  ([graph/watch.ts](../../packages/core/src/graph/watch.ts)):
  - a value the node's `output.schema` doesn't list (`watch.value`);
  - a `json.` field it doesn't list, when it has one (`watch.field`);
  - waiting for `!ok`, or anything else false of every tested look, which has
    `ok` true and exit code 0, such as `exitCode == 1` (`watch.until`).
    `exitCode == 0` is fine: it waits for a look to succeed.
- A timer can't hold more than about 24 days, so a duration is at most `596h`.
- The node's own `timeout` bounds each look, and a look past it counts as
  failed.
- **The last look is the node's output.** The node runs once: its `runs` is 1,
  and `round` doesn't change between looks.
- **How a wait ends:**
  - `until` holds on a successful look: the node succeeds.
  - A failed look, which is a non-zero exit, a tool reporting an error, a lost
    connection or a look past its own timeout, tries again at the next look. A
    good look resets the count, and `misses` in a row (default 3) fail the node.
  - An answer that can't be mended by waiting fails it at once: a value outside
    `output.schema`, JSON that can't be read, a command outside `allow`.
  - `watch.timeout` passing fails it, keeping the last look's output with
    `timedOut: true`. It's an ordinary failure, so `when: "!ok"` catches it.
- **Waiting isn't work.** The time between looks doesn't count against
  [`limits.timeout`](../scheduler.md#timeouts) while nothing else in the run is
  working; the time a look takes does, and so does anything running beside it.
  An owner's clock stands still for a child between looks.
- **It holds no session slot,** as only a Claude session takes one, so it can't
  block work at `concurrency: 1`. Only agent nodes can be delegated to, so a
  node that watches is reached by an edge, or is an entry.
- **Control:** a pause holds it between looks and stops `watch.timeout`'s clock;
  a look under way finishes. `ork stop` ends it. A resumed run looks again from
  the start.
- **`$ORK_STATE`,** for a tool node's program, names a file kept between looks,
  rounds and a resume, for telling what's new. The program creates it. It sits
  in the run's private `.state` folder, and goes when the run succeeds.

**What's recorded:** `watch.started`, `watch.changed` when a look says something
the last one didn't, and `watch.ended` with the number of looks and how it
ended. With `output.schema`, only the declared fields are compared, so a
timestamp isn't a change. The first look's `tool.called` is recorded and the
rest aren't.

The Monitor shows what a node is waiting for. As looks aren't recorded, its
count since the last change, and when the next look is, are worked out from
`every` and say "about".

## Triggers

### The file

`triggers.yaml` sits with a project's other files: `.ork/triggers.yaml`, or
`~/.ork/projects/<id>/triggers.yaml` when attached. Its JSON Schema,
[triggers.schema.json](../../packages/schema/triggers.schema.json), is generated
from the Zod model like the workflow's, and a test fails when it is stale.

```yaml
schemaVersion: 1
triggers:
  new-issue:
    every: 5m # at least 1m
    check:
      type: tool.gh
      command:
        issue list --search created:>=2026-11-04 --limit 30 --json number --jq
        '{events:[.[] | {key:(.number|tostring),
        inputs:{issue:(.number|tostring)}}]}'
    run: triage # a workflow's name in this project: not a path or a flag
    inputs: { mode: quick } # optional; every run gets these
    maxRunsPerDay: 10 # the default
    concurrency: 1 # the default
```

A check is what a tool or MCP node takes, without `watch` or `notify`. It takes
no templates anywhere, having nothing to read, except that its `env:` can read
the user's own variables as `{{env.NAME}}`. Text in a `script:` isn't a
template, so `{{` means nothing there. Its result is
`{ "events": [{ "key": "...", "inputs": { ... } }] }`, read as a tool's JSON
result. It's bounded by its `timeout`, or 5 minutes. With no `check`, a trigger
starts a run every time.

`ork validate`, run with no file named, checks the project's triggers too:

| Code                | Severity | What it means                                                          |
| ------------------- | -------- | ---------------------------------------------------------------------- |
| `trigger.workflow`  | error    | no valid workflow of that name                                         |
| `trigger.budget`    | error    | its workflow has no `limits.budgetUsd`                                 |
| `trigger.input`     | error    | an input it doesn't declare, or a schedule missing a required one      |
| `trigger.check`     | error    | a `watch`, `notify` or template on a check                             |
| `trigger.read`      | error    | a file it needs can't be read, such as a folder where a file should be |
| `trigger.untrusted` | warning  | [a prompt reads what a check found](#inputs-from-a-source), tools wide |

A trigger with an error doesn't run, even if it was accepted: its workflow may
have lost its budget since.

### The guards

Each is in [triggers/watcher.ts](../../packages/core/src/triggers/watcher.ts),
so no author writes them:

- **The first look starts nothing,** after each acceptance. It records what's
  there, so a backlog doesn't start a run each. A schedule's first look starts
  nothing either.
- **Each key starts once.** Seen keys live in the store, and a key is marked
  just before its run starts, so a crash, or a report that lists it twice, can't
  start it twice, and a run that fails isn't started again.
- **A key that won't start doesn't hold up the others.** It's unmarked and tried
  at the next look. After 3 looks in a row it's kept as seen, with no run, and
  `ork watch`'s output says so. A start that isn't recorded within 15 seconds is
  killed, so a slow start can't also go on to run.
- **Spending is capped before it starts:** `trigger.budget`, then
  `maxRunsPerDay` per calendar day.
  [Limits across runs](../usage.md#limits-across-runs) hold a trigger until they
  reset.
- **One at a time by default.** With `concurrency` runs going, a new key waits
  for the next look.

A failed look starts nothing and is said in `--status`, and the next goes on as
usual. What's holding a trigger is said there too. A clock moved back doesn't
stop a trigger: a last look that seems to be in the future counts as due.

### Trust

A trigger runs code with nobody there, and `triggers.yaml` is in the repository,
so pulling a branch could change what runs here. So `ork watch` runs only what
was accepted on this machine
([triggers/trust.ts](../../packages/core/src/triggers/trust.ts)). The store
keeps a hash of:

- the trigger;
- the text of the workflow it starts;
- the project's folder, so another repository with the same name and files
  doesn't inherit it;
- what its check reads: `.mcp.json` for an MCP check, and any file under the
  project that a tool's `command` or `interpreter` names.

A change to any of them turns it off, and `ork watch --accept` asks about each,
saying whether it's new or changed. Forgetting a project forgets what was
accepted for it.

**What runs is what was accepted.** A run starts from the workflow file's whole
path, so a file a branch adds at the project's root can't stand in for it, and
with `--expect-workflow`, an internal flag holding the hash of the text
[`ork watch`](#the-process) read. If a pull lands while a check is looking, the
run refuses, and the next look finds the trigger changed.

The hash can't cover all a run reads: skills, agents in their own files, scripts
the workflow calls, workflows it calls and `project.yaml` aren't in it
([L119](./watching-limits.md)).

Accepting takes a terminal: it refuses without one and inside a run, and the UI
only shows how things stand. The marker for "inside a run" is an environment
variable ([ADR-047](../../decisions/ADR-047-script-identity-env-json.md)), so
this stops accidents rather than a determined program. Accepted hashes aren't in
the repository. All of what `--accept` and `--status` print from a project or a
check has its escape sequences and line breaks taken out first.

### Inputs from a source

A stranger can file an issue, and its title can reach a prompt. A value can't
become extra arguments: each is passed joined to its flag, and its name has to
be one the workflow declares. A trigger's own `inputs:` win over what a check
reports.

What a check reports is marked: `run.started`'s settings carry `trigger` and
`untrusted`, the input names, and `ork logs` says so. `trigger.untrusted` warns
when a prompt or `instructions:` reads one on a node whose `tools: { only }`
isn't limited to `Read`, `Grep` and `Glob`. It can't prove a workflow safe, so
it warns rather than refuses.

### The process

`ork watch` runs in the foreground, or with `--detach`, its output in
`~/.ork/watch/output.log`. It covers every registered project, one per machine
by a row in the store, taken in one transaction
([triggers/lock.ts](../../packages/core/src/triggers/lock.ts)). A holder whose
process has gone doesn't hold it, nor does one whose id another process has
since been given, told by the process having started after the row was written,
so `--stop` doesn't signal a stranger. The same test, beside the start a run
records ([event store](../event-store.md#runs-and-events)), keeps a recycled id
from holding a trigger's `concurrency`.

It sees what's due every 10 seconds, re-reading each project's files, and each
look runs apart from the others, so a stuck one can't delay the rest. A file
that can't be read turns off that project's triggers, and is reported rather
than ending the watcher for the others. It installs nothing: the
[guide](../../docs/guides/watching.md) shows how to keep it alive across a
restart. A machine that's asleep isn't looking; on waking it looks again, and
anything new still on the list starts then, up to the daily cap. A run it starts
is an ordinary run.

`ork watch --status`, [`GET /api/triggers`](../server/api.md) and the Runs panel
say what's live and when each last looked. `ork doctor` warns of a live trigger
that hasn't looked for twice its `every`, when nothing is watching, and of a
file it can't read.

While it runs, `ork watch` also checks every registered project's `after-merge`
[follow-ups](../follow-ups/surfaces.md#the-cli) through the user's `gh` every 10
minutes, and prints a `follow-up due` line for each one that came due
([watch.ts](../../packages/cli/src/commands/watch.ts)).
