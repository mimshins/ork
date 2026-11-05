# Scripts in a workflow

A tool node can do work that would otherwise take a model turn: read a command's
result, decide where the run goes, and hand the next step what it needs.

## Return JSON

```yaml
pr:
  type: tool.gh
  command: pr view {{inputs.pr}} --json state,mergeable
  output:
    format: json
    schema:
      state: [OPEN, CLOSED, MERGED]
      mergeable: string
```

An edge then reads `when: "json.state == 'OPEN'"`, and a later node reads
`{{nodes.pr.output.json.mergeable}}`.

`schema:` declares what you rely on, as a list of values or a type (`string`,
`number`, `integer`, `boolean`). It's optional, but it pays three times: the
builder offers those values as choices, so one can't be mistyped; `ork validate`
stops warning that nothing declares the field; and a run checks it. A value that
doesn't fit fails the node and says why, rather than a condition quietly
matching nothing. To handle that, or any failure, give an edge `when: "!ok"`.

`ork validate` and `ork run` stop on a condition that compares a field with a
value it can't have: one outside a declared list, a Claude node's `status`, or a
gate's `choice`. The message names the values it can have. A Claude node's own
`status` list can narrow the built-in ones, but can't add others, as a session
can't report them; declare another field, such as `verdict`. A warning, such as
a loop only its rounds can end, prints too, and the run goes ahead.

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

## Write a short script in the workflow

For a few lines that don't deserve a file, `script:` replaces `command:` on a
`tool.shell` node:

```yaml
check:
  type: tool.shell
  env:
    BASE: "{{nodes.pr.output.json.baseRefName}}"
  script: |
    git fetch origin "$BASE"
    git diff --quiet "origin/$BASE" -- src || ./scripts/check.sh
```

- **Values arrive through `env:`, as `$NAME`.** A `{{` in a script is refused
  when the workflow is checked, so a value can't become code.
- **It stops at the first failure,** and on a variable that isn't set: the
  default is `sh -eu`, stricter than running a file with `sh`.
- **`interpreter:` runs it another way:** `interpreter: python3`, or
  `interpreter: bash -euo pipefail`. A run won't start if that program is
  missing.
- **Logs show `sh -eu <script>`,** not its text; the workflow file has it.

A file in your repository is still better for anything you'd want to lint or
test.

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
| `ORK_STATE`    | With [`watch:`](./watching.md), a file kept between looks |
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

## Contents

- [Steps around a session](./scripts/steps.md): check a session's work, and set
  a node up
- [Tell a session what happened](./scripts/messages.md)
- [Call an MCP tool](./scripts/mcp.md)
