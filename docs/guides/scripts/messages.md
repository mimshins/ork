# Tell a session what happened

_Part of [Scripts in a workflow](../scripts.md)._

A program writes to a session with `ork send`, and a workflow can declare a
message with `notify:`. Neither takes a model turn.

```yaml
nodes:
  builder:
    type: claude.worker
    prompt: Make the change. A check writes to you when it finds something.
  tests:
    type: tool.shell
    command: ./scripts/check.sh
    notify:
      - to: builder
        when: "!ok"
        body: |
          Tests failed:
          {{nodes.tests.output.stderr}}
messages:
  - between: [tests, builder]
```

Inside `check.sh`, `"${ORK_BIN:-ork}" send builder -m "lint found 3 problems"`
or `--stdin` sends one. It prints nothing when it works, and exits 1 with the
reason on stderr when it can't, so a script can act on that. A message can be up
to 64 KiB; for more, write a file and send its path.

- **Whom a program can write to:** its node's owner and its channels. The
  channel above is one way: a session can't write back to a program.
- **Whom a rule can write to:** any leader or worker, with no channel.
- **`when:` and `body:`** read what an edge's `when:` does, plus `ok` and
  `error`, so a body can say `{{error}}` or `{{output.summary}}`, also on a
  spawned worker. A node's own fields called `ok` or `error` need
  `nodes.<id>.output.ok`, and `ork validate` warns about them. With no `when:` a
  rule fires on every finish, and with no `body:` it sends Ork's one line on the
  result, such as `check exited 1: <last stderr line>` or
  `check failed: timed out after 5m`. A call with `wait: none` only says it
  started its run.
- **Stopping isn't failing.** `ork stop` fires no rule for what it cuts off, and
  the node runs again on `ork resume`. `ork stop --node` does fire one, as the
  run goes on without that node.
- **Messages start no session.** A node that isn't running finds the message
  when it next starts. `ork resume` keeps it unread, and doesn't send a rule's
  again.
- **It can cost a turn.** A message reaching a session just as it ends resumes
  that session once to read it, as any late message does. That turn stays within
  what's left of the budgets, and can't fail a node that already passed.
- **It isn't the user speaking.** The session sees a notice, and `read_inbox`
  shows `via: "script"` or `via: "rule"`. These hold no more authority than an
  agent.

`ork send` and a rule's body mask the values above. An `--input` value is masked
only if it's one of them, so don't put a secret in a body through
`{{inputs.*}}`. A program sends at most 100 messages in a run. See
[`examples/checked-build.ork.yaml`](../../../examples/checked-build.ork.yaml),
which needs `./scripts/check.sh` in your project and `CI_TOKEN` set.
