# Permissions without asking

On `claude-code`, a session asks Ork about every tool call its own rules neither
allow nor deny, and each question used to reach you. Ork now answers the ones it
can, so you are asked only about what is new. This applies to `claude-code`
nodes only: the other drivers have no prompt to answer and stay
[denied unless allowed](./drivers.md#permissions-denied-unless-allowed).

## Reads Ork already knows

A shell line is read command by command, through loops, subshells and wrappers.
Ork allows it with no question when **every** command in it is covered by the
node's `allow` rules or by Ork's own list of reads:

- Ork's reads: `ork logs`, `ork ps`, `ork tree`, `ork usage`,
  `ork feedback list|show` and `ork follow-ups list|show`, run as the installed
  `ork`. `pnpm ork …` and `pnpm -s ork …` are not in the list: pnpm runs the
  project's own `ork` script, so an edited `package.json` would change what a
  read runs.
- Filters and printers: `jq`, `wc`, `cut`, `sort`, `uniq`, `head`, `tail`, `tr`,
  `ls`, `echo`, `printf`, `pwd`, `basename`, `dirname`, `date`, `cd`, `true` and
  `false`.

Each is in the list only without the form that writes a file, follows one or
runs a program: `sort -o`, `uniq` with an output file, `tail -f`, `date -s`,
`date -f`, `jq -f` or a `jq` program that reads the environment, `printf -v`. A
path outside the session's folder and `~/.ork` still asks, and so does a path a
`Read(…)` deny rule of the node names. A line such as this one no longer asks:

```sh
for r in r1 r2; do ork logs "$r" --json | jq '.[0]' | head; done
```

The wrappers `timeout`, `env`, `cd`, `time` and `nice` are looked through, so
`timeout 60 ork logs r1` is checked as `ork logs r1`. A deny rule still wins: a
command that matches or may match one asks no one and is refused.

Ork asks, as before, about a line it cannot read with certainty: a redirect to a
file, `$(…)` or backticks, a heredoc, `eval`, `sh -c`, `xargs`, `sudo`, a loop
over a glob, a program named by a variable, an unclosed quote. `sed`, `awk`,
`find`, `tee` and interpreters are never in the list.

## A read-only node refuses

A node in a read-only worktree (`isolation: readonly`) is **refused**, not
asked, a shell command that its rules do not allow. The session gets a message
that names the node's `Bash` rules and the reads above, and the `extract` call
to make for a command that reads files, and goes on. Nobody waits and nothing is
recorded as a decision. A line Ork cannot read, a tool other than `Bash`, and an
`ork run --yolo` run are never refused.

To bring the question back, set `unlisted: ask`:

```yaml
# a node
tools:
  unlisted: ask
# a workflow's rules
rules:
  permissions: { unlisted: ask }
# .ork/project.yaml
permissions:
  unlisted: ask
```

The node's setting wins over the workflow's, which wins over the project's;
`refuse` is the other value and the default for a read-only node. A node that
writes asks unless you set `unlisted: refuse` for it.

## Allow for this node, this run or always

When Ork can read a shell line and offers a rule for it, the question has five
answers, in the terminal, `ork decide`, the browser and Ork's MCP tools:

- **allow**: this call only.
- **allow for this node**: this call, and the shown rules for this node for the
  rest of the run.
- **allow for this run**: the same for every node of the run.
- **always allow**: the rules go into `permissions.allow` of `.ork/project.yaml`
  (or `~/.ork/projects/<id>/project.yaml` for a
  [registered project](./projects.md)), and apply for the rest of the run.
- **deny**.

The descriptions show the exact rules before you choose, and `always` shows the
file. A rule is the program and its subcommand: `ork logs r1 --json` offers
`Bash(ork logs *)`, `git -C x log` offers `Bash(git log *)`, and a `pnpm` script
such as `pnpm -s ork logs r1` offers its own rule (`Bash(pnpm -s ork logs *)`)
but is never one of the reads above. Ork offers no rule for an interpreter, a
wrapper, `sh`, `xargs`, `find`, `sed`, `awk`, `pnpm exec` or `npx`, and no
scopes for a line it cannot read: those ask `Allow` or `Deny` only. A question
that comes back after a resume reads the same answers.

"Always" keeps the file's comments and every line it did not touch, creates the
file with `schemaVersion: 1` when there is none, and adds nothing already there.
The file is yours to commit: once it is, the rule applies to every contributor's
nodes. If the write fails, the call is allowed for the run and the terminal says
so.

## Rules Ork suggests

When the same rule has been allowed (once, for a node or for a run) at least 3
times across at least 2 runs of a project, and the project's `permissions.allow`
does not cover it, Ork files one [feedback](./feedback.md) item,
`permission.suggest`, with the rule and the file to add it to. It writes
nothing: you add the line, or dismiss the item. Nothing but the rule is kept,
never a command's arguments.

## Other drivers

The refusal, the five answers and the suggestions are `claude-code` only. The
guards that Codex, Command Code and omp write from a node's rules read loops,
subshells and the wrappers above with the same reader, so a rule you wrote
covers what it covers in a loop. They also allow
[the reads Ork already knows](#reads-ork-already-knows) (the installed `ork`'s
reads and the filters listed there) without a rule, when each path is inside the
node's worktree and the line has no `cd` and no expanded word such as `$VAR`,
`~` or a glob; a `deny` rule, an `only` list and a read-only node's `extract`
refusal still win ([drivers](./drivers.md#permissions-denied-unless-allowed)).
OpenCode gets none of this, and its reads need an `allow` rule. When one of
these drivers or OpenCode refuses the same tool three times in one node, Ork
files a [feedback](./feedback/reading.md#where-it-comes-from) item,
`tool.refused`, that names the tool.
