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

- Invalid or empty JSON fails the node, even if the program exited 0.
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

- The run won't start if the variable is not set.
- Logs record the names in `env:`, never the values.
- A value from `{{env.NAME}}` of eight characters or more is replaced by
  `[masked]` in what the program prints. Ork can't catch a secret a program
  finds by itself and prints, beyond its usual patterns.
- `ork validate` warns about a literal value under a name like `API_KEY`,
  because the workflow file goes to git.

## Know where it is running

A program also sees:

| Variable       | What it holds                                   |
| -------------- | ----------------------------------------------- |
| `ORK_RUN`      | The run's id                                    |
| `ORK_NODE`     | This node's id                                  |
| `ORK_ROUND`    | Which round of a loop this is, from 1           |
| `ORK_RUN_DIR`  | The run's folder, for files of its own          |
| `ORK_PROJECT`  | The project's root                              |
| `ORK_WORKFLOW` | The workflow's name                             |
| `ORK_BIN`      | The `ork` to call; use `"${ORK_BIN:-ork}"`      |
| `ORK_OUTPUT`   | With `output: { format: json }`, the file above |

These say who a program is but don't limit what it can do: it runs as you.
`ork chat` refuses inside a run, because it speaks as you. Claude sessions don't
get these variables; their Bash has only `ORK_SESSION=1`, so an agent can't use
`ork chat` either.
