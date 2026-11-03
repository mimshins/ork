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
Ork asks you, in `ork decide` or the UI's inbox, whether to go on or end the
link.

A link ends when either run does, and the other session is told. Messages to a
finished run are refused rather than resuming it; you can bring a session back
yourself with `ork chat`. `ork resume` does not bring links back, so link again
after a resume.

## Limits

Each run keeps its own budget and `limits.concurrency`, so linked runs spend
separately. Set `limits.budgetUsd` on each. Links work on one machine.

## Turning links off

Every leader and worker gets the message tools, so it can be linked later. That
adds a little to each session's prompt. To leave them out, and refuse links, set
this in `.ork/project.yaml` or a workflow's `rules`:

```yaml
links: off
```
