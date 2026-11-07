# Working across projects

A change often spans repositories: an API in one, its client in another. Ork can
run a workflow in each at the same time, and you can introduce their sessions so
they message each other while they work.

```sh
cd ~/code/backend    && ork run feature --detach   # run a1b2c3d4
cd ~/code/client-kit && ork run feature --detach   # run e5f6a7b8

ork relay a1b2/builder e5f6/builder
```

The run's id can be a prefix. Each side is told at its next step who it can now
write to, and which project that node works in. The nodes must be a
`claude.leader` or `claude.worker`, and their runs must be live.

To have one workflow start the other, and use its result, see
[Calling a workflow](#calling-a-workflow).

## What the sessions can do

- **`send_message`** with `to: "e5f6a7b8/builder"`. The other session sees a
  one-line notice and reads the message with `read_inbox`.
- **`wait_for_messages`** waits for a reply without ending the session. It holds
  no session slot while it waits, so it does not count against
  `limits.concurrency`.

That is all a link gives them. A node cannot read the other's files, and it
cannot start, stop or answer for the other run. A peer's message is another
agent's, and never carries your authority.

## Keeping an eye on it

```sh
ork relay list            # live links, and how many messages each has used
ork relay list --all      # ended ones too
ork relay end a1b2/builder e5f6/builder
ork logs a1b2 -f          # each run's logs show both sides of its conversation
```

A link has a limit of 100 messages, both ways together, to stop two agents
answering each other for ever. Set another with `--max-messages`. At the limit
Ork asks you, in `ork decide` or the Decisions panel of `ork ui`, whether to go
on or end the link.

A link ends when either run does, and the other session is told. Messages to a
finished run are refused rather than resuming it; you can bring a session back
yourself with `ork chat`. `ork resume` does not bring links back, so link again
after a resume.

## Limits

Each run keeps its own budget and `limits.concurrency`, so linked runs spend
separately. Set `limits.budgetUsd` on each. Links work on one machine.

## Calling a workflow

A `workflow.call` node starts a workflow as a run of its own, here or in another
registered project, and waits for it. Edges and `when` treat it as any node.

```yaml
schemaVersion: 1
name: feature
inputs:
  feature: { type: string, required: true }
nodes:
  backend: { type: claude.worker, prompt: "Build {{inputs.feature}}" }
  client:
    type: workflow.call
    project: client-kit # a registered project; leave it out for this one
    workflow: feature
    inputs: { feature: "{{inputs.feature}}" }
  notes:
    type: claude.worker
    prompt: "Write release notes for {{nodes.client.output.outputs.version}}"
edges:
  - backend -> client
  - { from: client, to: notes, when: "status == 'pass'" }
```

The called workflow says what it hands back:

```yaml
outputs:
  version: "{{nodes.bump.output.stdout}}"
```

The called run works under its own project's rules, agents and worktrees, keeps
its own logs, and is an ordinary run: `ork logs`, `ork tree` and `ork decide`
all take its id, which the caller's log prints.

- **`wait`** says when the node finishes: `run` when the run has ended, the
  default; `node` when a node you name has reported; `none` once it has started.
- **`node: builder`** keeps one run as a conversation. Each new activation hands
  the node its input, and resumes its session if it has ended, as a leader is
  when it is re-entered. Use `maxRounds` to bound the cost.
- **Talking during the work.** Add a channel, and your agents write to the call
  by name. Ork makes the link when the call starts, and the called workflow
  needs no change:

  ```yaml
  messages:
    - between: [backend, client]
  ```

- **`ref`** starts the called run's worktrees from a branch, such as
  `"{{nodes.backend.output.branch}}"`.
- **Refusals** fail the node with the reason, and a `when` edge can handle them.
  `ork validate` checks the workflow, the node and the required inputs of a
  registered project, and warns about one that is not registered on this
  machine.
- **Who may call.** Any registered project, unless the called project's
  `.ork/project.yaml` limits it:

  ```yaml
  calls:
    accept: [backend]
  ```

**The budget is shared.** A called run gets the lesser of its own
`limits.budgetUsd` and what the caller has left, and what it spends counts
against the caller.

**A stop reaches down.** `ork stop` on the caller stops what it called, and
`ork resume` on the caller resumes those runs too, keeping the nodes that
finished. A called run that failed gets a retry the same way. Pause does not
spread.

**Its questions wait.** A called run has no terminal, so what it asks waits in
`ork decide` or the Decisions panel of `ork ui`, even when the caller is in your
terminal.

Calls nest up to 5 deep.

## Turning links off

Every leader and worker gets the message tools, so it can be linked later. That
can add a little to each session's prompt. To leave them out, and refuse links,
set `links: off` for the whole project, or for one workflow:

```yaml
# .ork/project.yaml
links: off
```

```yaml
# a workflow
rules:
  links: off
```
