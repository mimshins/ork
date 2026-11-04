# Scripts in a workflow

A tool node can do work that would otherwise take a model turn: read a command's
result, decide where the run goes, and hand the next step what it needs.

## Return JSON

```yaml
pr:
  type: tool.gh
  command: pr view {{inputs.pr}} --json state,mergeable
  output: { format: json }
```

An edge then reads `when: "json.state == 'OPEN'"`, and a later node reads
`{{nodes.pr.output.json.mergeable}}`.

A script that logs to stdout writes its result to the file at `$ORK_OUTPUT`
instead. That file wins when it is written. Otherwise Ork parses all of stdout.

- Invalid or empty JSON fails the node, even if the program exited 0. The error
  doesn't quote what the program printed, as it may hold a secret; the node's
  `stdout` shows it, scrubbed.
- `$ORK_OUTPUT` must be a file: a folder or a link there fails the node.
- A program that fails isn't parsed: the node fails as usual.
- A result over 64 KiB fails the node and is kept in a file under `.ork/runs/`.
  It is never cut.

## Give a program its environment

Use `env:`, and quote the value in the script, rather than templating a value
into `sh -c`:

```yaml
check:
  type: tool.shell
  command: ./scripts/check.sh
  env:
    BASE: "{{nodes.pr.output.json.baseRefName}}"
    GH_TOKEN: "{{env.STAGING_GH_TOKEN}}"
```

`{{env.NAME}}` reads your own variable, and only `env:` may read one.

- The run won't start if the variable is not set. For a workflow it calls by
  name, it warns instead, as that call may never run, and the call fails if the
  run reaches it.
- Logs record the names in `env:`, never the values.
- A value from `{{env.NAME}}` of eight characters or more is replaced by
  `[masked]` in what every tool node of the workflow prints or returns, in any
  form a JSON encoder writes it, including JSON keys and numbers. The same goes
  for workflows it calls by name, and for those calling it. Each line of a
  multi-line value and each value in a JSON one is masked too, so a program that
  prints only part of it is covered, and that text is masked wherever it
  appears. Ork can't catch a secret encoded another way, such as base64 or URL
  encoding, one read by a workflow called by a computed name, or one a program
  finds by itself, beyond its usual patterns.
- `ork validate` warns about a literal value under a name like `API_KEY`, or a
  URL with a password in it, because the workflow file goes to git.

Masking applies to every value you read this way, so a value that isn't secret
comes back as `[masked]` too, and a later `when:` or `{{nodes.…}}` sees that.
Say so with `plainEnv`, which lists the variables that node reads:

```yaml
deploy:
  type: tool.shell
  command: ./scripts/deploy.sh
  env:
    REGION: "{{env.AWS_REGION}}"
    GH_TOKEN: "{{env.STAGING_GH_TOKEN}}"
  plainEnv: [AWS_REGION]
  output: { format: json }
```

A variable stays masked if any node reads it without listing it.

## Tell a session what happened

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
[`examples/checked-build.ork.yaml`](../../examples/checked-build.ork.yaml),
which needs `./scripts/check.sh` in your project and `CI_TOKEN` set.

## Know where it is running

A program also sees:

| Variable       | What it holds                                             |
| -------------- | --------------------------------------------------------- |
| `ORK_RUN`      | The run's id                                              |
| `ORK_NODE`     | This node's id                                            |
| `ORK_ROUND`    | Which activation this is, from 1; a resume can repeat one |
| `ORK_RUN_DIR`  | The run's folder, for files of its own                    |
| `ORK_PROJECT`  | The project's root                                        |
| `ORK_WORKFLOW` | The workflow's name                                       |
| `ORK_BIN`      | The `ork` to call; use `"${ORK_BIN:-ork}"`                |
| `ORK_OUTPUT`   | With `output: { format: json }`, the file above           |
| `ORK_MASKED`   | The names of the variables to mask, never values          |

These say who a program is but don't limit what it can do: it runs as you.
`ork chat`, `ork continue` and answering with `ork decide` refuse inside a run,
because they act as you, and `ork ui` keeps its sign-in link to itself there.
`ork decide --list` still works, and so does `ork stop`.

Claude sessions don't get these variables. They inherit your own, like any
program you start, so a session can read the variable behind
`{{env.STAGING_GH_TOKEN}}`, and masking doesn't apply to its transcript. Their
Bash also has `ORK_SESSION=1`, so an agent can't use those commands either.

If a refusal reaches you at your own terminal, that shell inherited the variable
it names from a program in a run, a tmux server started by one for example. Open
a shell without it.
