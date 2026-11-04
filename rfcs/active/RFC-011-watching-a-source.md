# RFC-011 — Watching a source, and acting on what it says

- **Status:** Accepted
- **Date:** 2026-11-04
- **Supersedes:** —
- **Superseded by:** —

## Contents

- [Context](#context)
- [Options](#options)
- [Decision](#decision)
- [Consequences](#consequences)
- [Open questions](#open-questions)
- [Answered questions](#answered-questions)

## Context

A workflow often needs to wait on something outside it: a CI job finishing, a
review thread appearing on a pull request, a new issue being filed. Ork has no
node or command for this. There are two different needs here:

- **Waiting inside a run:** the run exists, and pauses at a step until a source
  says something. CI failed, so fix it and watch again.
- **Starting a run:** no run exists yet, and something should start one. A new
  issue was filed, so triage it.

They share one thing: a look at the source is a deterministic program, with no
model turn, and
[declared output](../archived/RFC-010-conditions-from-declared-outputs.md) says
what it can report. That's why one RFC covers both, at the maintainer's request.
Each part below can still be built without the other.

### What works today

A tool node can already wait, and route on what it found. This was run for real,
with a script polling local files, not a real GitHub:

```yaml
watch:
  type: tool.shell
  timeout: 20s
  script: | # waits for a result to appear, then writes it to $ORK_OUTPUT
  output:
    format: json
    schema: { result: [passed, failed] }
```

| Situation          | What happened                                                        |
| ------------------ | -------------------------------------------------------------------- |
| Fails, then passes | Watched, ran the fix, watched again and finished, with no model turn |
| Keeps failing      | Asked, then stopped when the loop's `maxRounds` ran out              |
| Nothing happens    | The node failed at its `timeout`, and the run with it                |

So the engine isn't what's missing. What this leaves to each author, or leaves
undone:

- **Everyone writes their own polling,** with its own sleep and its own handling
  of a failed look, such as a network error an hour into a wait.
- **Nothing shows that it's watching.** It's a running program, and the UI can't
  say what it's waiting for, or when it looks next.
- **Nothing remembers what was seen,** so "a new thread" means a state file the
  author has to invent.
- **Waiting counts as work.** `limits.timeout` measures work, and a wait is a
  program running. [ADR-043](../../decisions/ADR-043-timeouts.md) already
  reasons that time waiting on a person doesn't answer "is this stuck?". A wait
  on CI is the same.
- **A wait is bounded by design.** Every loop needs `maxRounds`, so a run can't
  watch forever. That's right for a run, and it means "whenever an issue is
  filed" can't be a run at all.

### What can't start a run

Nothing in Ork. `ork run --detach` starts one in the background, so cron or
launchd could call it, though that wasn't tried here. Each author would then
also write what stops an existing backlog firing at once, what stops one event
firing twice, and what caps the spending of something nobody is watching. The
roadmap's "Schedules and webhooks" item has waited on this RFC's question: a
local tool has no always-on process, and [the server](../../specs/server.md)
binds loopback only, so a webhook from GitHub can't reach it.

## Options

### Waiting inside a run

**W-A — Document the pattern.**

- **Pros:** nothing to build. It works today.
- **Cons:** keeps every gap above, and each author writes it again.

**W-B — A `watch:` block on tool and MCP nodes.**

- **Pros:** a look is what those nodes already do, so every integration, `allow`
  rule, secret mask and declared output works unchanged. It's a few fields, not
  a new concept. Ork owns the timing, so pausing, stopping and showing it are
  its job.
- **Cons:** a node's single run becomes many looks, and the events and the
  Monitor need to say so.

**W-C — A new `control.watch` node wrapping a program.**

- **Pros:** reads clearly on the canvas.
- **Cons:** it would repeat every field of a tool node, or wrap one, and needs a
  second form of each integration. A new integration would then need it too,
  where the convention is an adapter in one place.

**W-D — A session that polls.**

- **Pros:** can judge what it sees.
- **Cons:** a model turn for each look, on a wait that may last hours, which is
  what Ork exists to avoid. A session can already be told of a change by
  [`ork send`](../../specs/messaging/scripts.md#ork-send).

### Starting a run

**S-A — Document cron plus `ork run --detach`.**

- **Pros:** nothing to build, no process of Ork's.
- **Cons:** each author writes the seen list, the backlog guard and the spending
  cap. A mistake in any of them spends money unattended.

**S-B — `ork watch`, a long-lived command that runs declared triggers.**

- **Pros:** the guards are Ork's, so they can't be forgotten. It's a command
  like any other, and its process is the user's to keep alive or not. Runs it
  starts are ordinary runs, so everything else works on them.
- **Cons:** a new long-lived process, a new file, and code that runs with nobody
  watching, which raises the trust question below.

**S-C — Triggers inside `ork ui`'s server.**

- **Pros:** the process already exists, and the UI could show them.
- **Cons:** closing a tab's server would silently stop automation, and every
  `ork` command is meant to work without the UI.

**S-D — Webhooks.**

- **Pros:** instant, with no polling.
- **Cons:** needs an address GitHub can reach. Exposing a local port, or running
  a relay, goes against Ork's being local, and adds a credential to hold.

## Decision

**W-B and S-B.** A look is a deterministic program with declared output. Inside
a run, `watch:` repeats it until a condition holds. Outside one, `ork watch`
repeats it and starts a run for each new thing it reports. Neither takes a model
turn until something real happened.

### 1. `watch:` on tool and MCP nodes

```yaml
ci:
  type: tool.shell
  script: ./ci-state.sh # prints { "result": "pending" | "passed" | "failed" }
  output:
    format: json
    schema: { result: [pending, passed, failed] }
  watch:
    every: 30s
    until: "json.result != 'pending'"
    timeout: 2h
edges:
  - { from: ci, to: fix, when: "json.result == 'failed'" }
  - { from: ci, to: ship, when: "json.result == 'passed'" }
  - { from: fix, to: ci, maxRounds: 3 }
```

- **All three fields are required,** so a wait can't be endless by omission. A
  `timeout` is an ordinary failure, as in ADR-043, so `when: "!ok"` handles it.
- **`until` is a condition,** chosen in the builder with
  [the same picker as an edge](../archived/RFC-010-conditions-from-declared-outputs.md).
  It's checked like one, so a typo in a value can't wait forever on something
  that will never come: with RFC-009, that is `when.value`.
- **The last look is the node's output.** A value outside the declared list
  fails the node at once, as it would on any run, rather than being waited past.
- **A failed look isn't the end.** A network error shouldn't lose an hour's
  wait, so a non-zero exit retries at the next look, up to `misses` in a row
  (default 3).
- **Waiting doesn't count as work.** The time between looks counts neither
  against `limits.timeout` nor as spending. The time a look takes does.
- **It holds no session slot,** so it can't block work at `concurrency: 1`.
- **Control works as elsewhere:** a pause holds it between looks, a stop ends
  it, and a resumed run looks again from the start, as a look changes nothing.
- **It records changes, not looks,** so an hours-long wait doesn't fill the
  store: a `watch.changed` event when the output differs, plus a count at the
  end. The Monitor shows what it's waiting for, how many looks so far, and when
  the next is.
- **`$ORK_STATE` is a file kept between looks and rounds** of one node in one
  run, so a script can tell what's new without inventing a place to keep it.

### 2. `ork watch` and triggers

```yaml
# .ork/triggers.yaml, or ~/.ork/projects/<id>/triggers.yaml when attached
schemaVersion: 1
triggers:
  new-issue:
    every: 5m
    check:
      type: tool.gh
      command:
        issue list --limit 30 --json number,title --jq '{events:[.[] |
        {key:(.number|tostring), inputs:{issue:(.number|tostring)}}]}'
    run: triage # a workflow in this project
```

A check prints `{ "events": [{ "key": "...", "inputs": { ... } }] }`. Each key
not seen before starts one run of the workflow with those inputs. With no
`check`, a trigger is a plain schedule that starts a run every time.

**What it guards, so no author has to:**

- **The first look starts nothing.** It records what's there, so a backlog of
  400 issues doesn't start 400 runs.
- **Each key starts once.** Seen keys live in the store, and a key is marked
  when its run starts, so a run that fails isn't started again on its own.
- **Spending has a cap before it starts.** `ork validate` refuses a trigger
  whose workflow has no `limits.budgetUsd`, and each trigger takes
  `maxRunsPerDay` (default 10).
  [Limits across runs](../../specs/usage.md#limits-across-runs) still apply, and
  a run stopped by one stops that trigger until the limit resets.
- **One at a time by default.** `concurrency: 1` per trigger; a new key waits
  for the next look.
- **A new or changed trigger needs a person.** See below.

**The process is the user's.** `ork watch` runs in the foreground, or with
`--detach`. It covers every registered project, one per machine, as a lock file
says, and runs each check apart from the others, so a stuck one can't delay the
rest. It installs nothing: the guide shows a launchd and a systemd file for
those who want it to survive a restart, and Ork doesn't write them. A machine
that's asleep isn't looking; on waking it looks again, and anything still on the
list starts then. `ork watch --status` and the UI say what's live and when each
last looked.

**Trust.** A trigger runs code with nobody there, and `.ork/triggers.yaml` is in
the repository, so pulling a branch could change what runs on this machine. So
`ork watch` runs only triggers accepted here: it keeps a hash of each, says
which are new or changed, and leaves those off until `ork watch --accept`.
That's terminal-only, so a browser tab can't approve code to run unattended.
Accepted hashes stay on this machine, not in the repository.

**Inputs from a source are untrusted.** A stranger can file an issue, and its
title can reach a prompt. A tool's arguments are already safe, as a value never
becomes extra arguments, but a session reads what it's given. So Ork marks every
input a trigger passes as untrusted, and a new warning, `trigger.untrusted`,
fires when a prompt reads one on a node whose tools aren't narrowed. It can't
prove a workflow safe, so it warns rather than refuses, and the guide shows the
safe pattern: read fields by number, with narrow `tools:` on the node that reads
them.

### What this leaves out

- **Webhooks,** for now. A check is a program, so a later one could block until
  something pushes to it, with no change to this design.
- **A cron-style calendar** ("weekdays at 9"). `every:` covers the examples. It
  can be added to the same field.
- **A trigger reading a stream.** Looks read a list, so an event that falls off
  the end between looks is missed. It's a limit to record.

## Consequences

**Better:**

- The three examples each have an answer. CI failing is a `watch:`. A review
  thread is a `watch:` with `$ORK_STATE`, or a trigger. A new issue is a
  trigger.
- Long waits cost no tokens, and the first model turn comes after something
  happened.
- It closes the question "Schedules and webhooks" was waiting on, with webhooks
  left out.

**Worse:**

- A long-lived process of Ork's, for the first time beyond a run or the UI, with
  a lock to keep and a way to die quietly. `ork doctor` should report a trigger
  that hasn't looked when it should have.
- Unattended spending. The guards limit it but can't remove it, and a mistaken
  trigger can still spend its daily cap on nothing.
- Polling uses the user's API quota for each source. A short `every` on many
  checks can use it up, which is why `every` has a floor.
- `triggers.yaml` is a second file format, with its own schema, builder support
  later, and migration.

**Follow-up work:**

- Specs: [workflow-format.md](../../specs/workflow-format.md),
  [scheduler.md](../../specs/scheduler.md), [cli.md](../../specs/cli.md),
  [project-rules.md](../../specs/project-rules.md), and the event list.
- Guides: waiting on something, and starting a run from an event, including the
  warning about untrusted input.
- An ADR, and the builder's form for `watch:`.
- Order: `watch:` first, as it's smaller and useful alone. Triggers reuse its
  timing.

## Open questions

1. **What should `every`'s floor be?** This RFC suggests 5 seconds for `watch:`
   and 1 minute for a trigger, with no measurement behind either. They're easy
   to change, so they can be set on the first real use.

## Answered questions

The maintainer's answers, on 2026-11-04.

1. **Does the time between looks count against `limits.timeout`?** No. Only the
   time a look takes counts, and `watch.timeout` bounds the wait.
2. **One `ork watch` per machine, or per project?** Per machine, with checks run
   apart from each other.
3. **How far should Ork go on untrusted input?** Mark trigger inputs as
   untrusted, and warn when a prompt reads one with broad tools.
4. **Where can a trigger be accepted?** In a terminal only. A future builder for
   triggers can't finish that step on its own.
