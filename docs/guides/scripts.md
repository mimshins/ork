# Scripts in a workflow

A tool node can do work that would otherwise take a model turn: read a command's
result, decide where the run goes, and hand the next step what it needs.

## Contents

- [Steps around a session](./scripts/steps.md): check a session's work, and set
  a node up
- [Tell a session what happened](./scripts/messages.md)
- [Call an MCP tool](./scripts/mcp.md)

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
value it can't have, such as one outside a declared list
([values a condition can't have](./writing-workflows/checking.md#values-a-condition-cant-have)).
An agent node's own `status` list can narrow the built-in ones, but can't add
others; declare another field, such as `verdict`.

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
- A value of eight characters or more from `{{env.NAME}}` shows as `[masked]` in
  what any tool node prints or returns, including inside JSON, and in workflows
  this one calls or is called by. Each line of a multi-line value, and each
  value in a JSON one, is masked on its own too.
- Ork can't catch a secret encoded another way (base64, URL encoding), one read
  by a workflow called by a computed name, or one a program finds by itself.
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

| Variable       | What it holds                                                                |
| -------------- | ---------------------------------------------------------------------------- |
| `ORK_RUN`      | The run's id                                                                 |
| `ORK_NODE`     | This node's id                                                               |
| `ORK_ROUND`    | Which activation this is, from 1; a resume can repeat one                    |
| `ORK_RUN_DIR`  | The run's folder, for files of its own                                       |
| `ORK_PROJECT`  | The project's root                                                           |
| `ORK_WORKFLOW` | The workflow's name                                                          |
| `ORK_BIN`      | The `ork` to call; use `"${ORK_BIN:-ork}"`                                   |
| `ORK_ITEM`     | In a node with `forEach`, the item: a string as it is, anything else as JSON |
| `ORK_INDEX`    | In a node with `forEach`, the item's place, from 0                           |
| `ORK_OUTPUT`   | With `output: { format: json }`, the file above                              |
| `ORK_STATE`    | With [`watch:`](./watching.md), a file kept between looks                    |
| `ORK_MASKED`   | The names of the variables to mask, never values                             |

These say who a program is but don't limit what it can do: it runs as you. A
program in a run can read and stop, but not answer, chat or continue for you:
`ork decide --list` and `ork stop` work, `ork chat`, `ork continue` and
`ork decide --choose` refuse.

Claude sessions don't get these variables. They inherit your own, like any
program you start, so a session can read the variable behind
`{{env.STAGING_GH_TOKEN}}`, and masking doesn't apply to its transcript. Their
Bash also has `ORK_SESSION=1`, so an agent can't use those commands either.

Both also carry `ORK_GUARDED_STORES`, a list of the stores whose runs started
them, and those commands refuse only in a store on that list. A run you start
from inside one, under another `HOME`, adds its store to the list and keeps the
outer one on it. Under that `HOME` its own programs can answer its decisions and
open `ork ui`; your real store stays refused. A marker with no list, from an
older `ork`, refuses everywhere. The variable is not settable by `env:`.

If your own terminal gets such a refusal, it inherited a run's variables, from a
tmux server a run started for example. Open a new shell.
