# Scripts and rules on the bus

_Part of [Messaging, decisions and logs](../messaging.md)._

Status: **Built, proven on a real session on the claude-code driver**
([ADR-048](../../decisions/ADR-048-scripts-and-rules-on-the-bus.md),
[send.ts](../../packages/core/src/remote/send.ts),
[rules.ts](../../packages/core/src/run/rules.ts),
[contacts.ts](../../packages/core/src/run/contacts.ts),
[engine tests](../../packages/core/test/notify.test.ts),
[CLI tests](../../packages/cli/test/send.test.ts)).

A deterministic step can tell a working session a fact with no model turn: a
program with `ork send`, and a workflow with `notify:`. Both land as any message
does, a notice and then `read_inbox`, labelled `via: "script"` or `via: "rule"`.

## Contents

- [`ork send`](#ork-send)
- [`notify:`](#notify)
- [Who may write to whom](#who-may-write-to-whom)
- [Trust](#trust)
- [On resume, and what can be lost](#on-resume-and-what-can-be-lost)

## `ork send`

```sh
ork send <to> -m <body>   # or --stdin
```

It runs inside a tool node, and reads `ORK_RUN` and `ORK_NODE`.

- **It prints nothing when it works,** as what a program prints is its node's
  output, and exits 0.
- **It exits 1 with the reason** on stderr when there is no `ORK_RUN`, the run
  is not running, it is a `--node` run, the recipient is not a contact (it lists
  who is), or the sender has sent 100 messages in the run. So it does for a
  command that names no node or more than one, and a message that is empty, not
  UTF-8 text, or over 64 KiB; what it prints goes to stderr so as not to land in
  the node's output.
- **The check is on the sender's side,** from the latest `run.started`, since a
  resume may change channels, so a refusal is an exit code. Whether the sender
  may write at all is checked before `--stdin` is read, and reading stops at the
  limit. Then a `script` row in the commands table and a wake on the run's
  socket; with no socket, the one-second poll finds the row, and the run looks
  once more before `run.finished`. The run records `message.received`.
- **The cap counts those rows,** in the transaction that adds one, so programs
  sending at once cannot pass it.
- **The body is masked before the store,** with the names in `ORK_MASKED`, which
  a tool node's program gets, as well as by the store's own patterns
  ([L81](./scripts-limits.md)).

A script reads nothing: a tool node is one shot, and nothing can write to it.

## `notify:`

A message a workflow declares on a node, sent when it finishes. On Claude
leaders and workers, tool nodes, gates and calls; not `agent.subagent`, which
runs inside its parent's session, nor control nodes, which have no result of
their own.

```yaml
tests:
  type: tool.shell
  command: ./scripts/check.sh
  notify:
    - to: builder
      when: "!ok" # optional; default: every finish
      body: | # optional; default: Ork's one line on the result
        Tests failed:
        {{nodes.tests.output.stderr}}
```

- **When:** once per fresh result, after `node.finished` and before the node's
  edges are routed, so a node an edge starts already has the message. A result a
  resumed run hands back does not fire again; a node that really runs again
  does.
- **A run stopping fires nothing for what it cuts off.** `ork stop`, the run's
  timeout and a crash are not the node failing, and the node runs again on
  resume. A node that passed as the run stopped still fires. `ork stop --node`
  does fire, as the run goes on without that node.
- **`to`** must be a leader or worker. A rule needs no channel, since the
  workflow's author declared it.
- **`when:` and `body:`** read what an edge's `when:` does, plus `ok` and
  `error`, because a failed node may have no output, and `nodes.<id>.output.*`
  for the node itself holds what this activation returned. Both are checked at
  compile time. `ok` and `error` hide a field of those names, with a
  `notify.shadowed` warning; `nodes.<id>.output.ok` still reads the field.
- **A body** is masked before it reaches the inbox: by the store's patterns, and
  with the values of the variables the run masks. It is cut at 64 KiB, as a rule
  cannot be refused.
- **The default body** is a pure function of the result:

  | Result                                             | Line                                                                 |
  | -------------------------------------------------- | -------------------------------------------------------------------- |
  | A program that ended                               | `<id> exited <code>`, then its last stderr line if it failed         |
  | Stopped, timed out, never started, or invalid JSON | `<id> failed: <why>`                                                 |
  | A session                                          | `<id> passed: <summary>` or `<id> failed: <why>`                     |
  | A gate                                             | `<id> answered: <choice>`, or that it timed out and took its default |
  | A call with `wait: none`                           | `<id>: Run <run> started.`, as nothing has passed yet                |

- **It starts no session.** A node that is not running finds the message when it
  next starts.
- **Spawned workers:** a rule on a template fires per instance, with the
  instance as sender. A rule to a template reaches the declared node's inbox
  only ([L88](./scripts-limits.md)).
- **`ork run --node`** has no bus: a rule does nothing, and the command says so
  once.

## Who may write to whom

One pure function decides, for the bus and `ork send` alike
([contacts.ts](../../packages/core/src/run/contacts.ts)). A program may write to
its node's owner and its channels. A channel accepts a tool node, one way:
`messages: - between: [tests, builder]` allows `ork send` from `tests`. A
session cannot write to a tool node and its prompt does not list one. The other
side must be a leader or worker.

A node a program or a rule may write to gets `read_inbox` and
`wait_for_messages` even with no one to write to itself.

## Trust

| Source            | Delivered as                | Authority               |
| ----------------- | --------------------------- | ----------------------- |
| User (`ork chat`) | pushed in full, "The user…" | the user's              |
| Agent or link     | notice, then `read_inbox`   | an agent's              |
| Script            | notice, then pull, `via`    | no more than an agent's |
| Rule              | notice, then pull, `via`    | no more than an agent's |

An author wrote the rule, but its body can carry program or model output, so it
must not read as an instruction from the user. A short line in the system
prompt, only for a node that can receive these, says so.

`ORK_RUN` and `ORK_NODE` are attribution, not proof: a program runs as the same
user with the same store, so it can forge them ([L80](./scripts-limits.md)). The
contact check stops mistakes and a prompt-injected send to the wrong session; it
is not a security boundary.

## On resume, and what can be lost

`message.sent` and `message.received` are stored like every event, so a resumed
run's inboxes hold them unread, with their `via`
([mail.ts](../../packages/core/src/run/mail.ts)). A message that reaches a
session as it ends triggers the one-time resume for
[late messages](../messaging.md#message-bus), which spends a turn no agent asked
for. What can be lost is in [L87](./scripts-limits.md). A message to a node that
never ran stays unread, and `ork run` warns of each such node at the end
([running](../cli/running-and-runs.md#running-a-workflow)).
