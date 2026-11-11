# Completion and help

_Part of [The ork CLI](../cli.md)._

Status: **Built**: `ork completion zsh|bash|fish`, the hidden `ork __complete`,
its live values, and the grouped `ork --help`
([command tree](../../packages/cli/src/command-tree.ts),
[position](../../packages/cli/src/completion/position.ts),
[candidates](../../packages/cli/src/completion/candidates.ts),
[values](../../packages/cli/src/completion/values.ts),
[sources](../../packages/cli/src/completion/sources.ts),
[scripts](../../packages/cli/src/completion/scripts.ts),
[commands](../../packages/cli/src/commands/completion.ts),
[groups](../../packages/cli/src/help-groups.ts),
[root help](../../packages/cli/src/help-root.ts),
[tests](../../packages/cli/test/completion.test.ts),
[value tests](../../packages/cli/test/completion-values.test.ts),
[help tests](../../packages/cli/test/help.test.ts),
[read-only store tests](../../packages/core/test/store-read-only.test.ts)). The
user guide: [tab completion](../../docs/guides/tab-completion.md).

## The command tree

`--help` and completion read one tree, built from citty's definitions of `ork`
and its subcommands, with the ones loaded on use resolved. Each command has its
name, description, aliases, public flags (name, description, whether it takes a
value, its aliases, an enum's options, and `--no-<name>` for a boolean on by
default) and positionals, in the order it defines them. A flag whose description
starts with `Internal:` is left out of both. The global `--plain` flag
([terminal](./terminal.md)) is offered with every command's flags, and `--help`
lists it. A subcommand whose definition is the same as one listed before it is
an alias of that one (`wt` of `worktrees`); a command with `meta.hidden`
(`__complete`) is in neither. A new command or flag shows up in both with no
change to this code.

## ork completion

`ork completion <shell>` prints the script for `zsh`, `bash` or `fish`, and
refuses another name, saying which there are. Ork never installs it.

- **zsh:** a `#compdef ork` file. Saved as `_ork` on the `fpath` it is
  autoloaded; sourced after `compinit`, it runs `compdef _ork ork`. Each group
  of candidates is one `_describe` call labelled with the group's title, in the
  order given; a `:files` answer adds `_files`.
- **bash:** `complete -F _ork ork`, loaded with `eval "$(ork completion bash)"`
  (macOS's bash 3.2 can't `source <(…)`). It splits the line up to the cursor
  itself, so `ork:feature` stays one word, and trims what bash's `:` word break
  would repeat. It reads candidates line by line with every expansion quoted, so
  none is joined, split or globbed. No descriptions (bash shows none).
- **fish:** `complete -c ork -f -a '(__ork_complete)'`; fish shows the
  descriptions as they come. It reads the words with `commandline -xpc` (fish
  4), falling back to `-opc` (fish 3). A `:files` answer adds
  `__fish_complete_path`.

## Answering the shell

```
ork __complete -- <words…>
```

The words are what follows `ork`, the word under the cursor last (empty when the
cursor follows a space). It prints one candidate per line,
`value<TAB>description`, starting with what was typed. Two kinds of line start
with `:`: `:group <title>` begins a group, and `:files` asks the shell for file
names too. A value a shell could misread is never printed: only letters, digits
and `_ . @ + , = / ~ - :`, not starting with `:`; so no space, control
character, quote or `$(…)`. A description is kept to one line.

- **Parsing** is citty's: a flag that takes a value takes the next word unless
  written `--flag=value`; a word that names a subcommand, before any positional,
  goes into it (an alias too); other words fill the positionals in order; after
  `--` every word is a positional.
- **At a word:** the subcommands (at the root in `ork --help`'s groups, with
  their short lines; below it under `commands`), then the values of the
  positional at that place.
- **At a word starting `-`:** the command's flags with their descriptions, and
  `--help`.
- **After a flag that takes a value:** an enum flag's options, else the values
  of the flag's provider, else nothing.

`bin.ts` runs `__complete` before citty and before the update check, so a typed
`--help` is a word to complete, and Tab never starts the daily check. Anything
that goes wrong prints nothing, with exit status 0.

### Values

A provider gives an argument's values, found by the argument's name, or by the
command's path and the name for one command only. A new command whose argument
has one of these names gets its values with no change.

| Argument                      | Group     | Values                                                                                                                                            |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run` (positional, `--run`)   | runs      | Run ids newest first, with workflow and status: the project's, else any project's starting with the prefix, else the newest of any; at most 50    |
| `workflow`, `files`           | workflows | The project's workflows by name, then Ork's own `ork:` ones; `files` also asks for file names                                                     |
| `node` (positional, `--node`) | nodes     | With a `workflow` positional, the nodes of the workflow given (none before it is); else the nodes of the run given, or the project's newest run's |
| `decide id`                   | decisions | Open decisions of live runs: the run given, else the project's; described by kind, run and node                                                   |
| `driver`                      | drivers   | The agent drivers' ids, with their labels                                                                                                         |
| `completion shell`            | shells    | The shells there is a script for                                                                                                                  |
| `path`, `file`, `output`      | files     | File names, from the shell                                                                                                                        |

A run's nodes are the nodes its events are about, in the order they first appear
(the store's `nodes` query). A workflow's are the keys of its `nodes`, read from
the file without validating it; a key that isn't a valid node id is left out.

### What it reads

The project is the one the folder is in, as for every command. The store is
opened read-only: when `~/.ork/state.db` does not exist nothing is created, and
a store at another schema version (newer, or older and not yet migrated) gives
no values; flags and commands are still offered. SQLite refuses every write on
that connection (it may still create the `-shm` and `-wal` files beside a store
in WAL mode, as any reader does; the database is not changed). Completion prints
ids, names, workflow names, statuses and driver labels; never a prompt, a
question, an output or a secret. It answers in under 300 ms on a store of 500
runs.

## ork --help

`ork --help` (and `ork` alone) lists the commands in groups, in this order:

| Group               | Commands                                   |
| ------------------- | ------------------------------------------ |
| Get started         | init, doctor, ui                           |
| Workflows           | validate, run, agents, context, watch      |
| Runs                | ps, logs, tree, usage, resume              |
| Steer a running run | decide, chat, pause, continue, stop, relay |
| After runs          | feedback, worktrees, prune                 |
| Projects            | projects, register, migrate, link          |
| Ork itself          | upgrade, mcp, send, completion             |

Each command shows a short line kept with the groups; its own `--help` keeps its
full description. An alias shows beside its command (`worktrees … (alias: wt)`),
never on a row of its own; a hidden command is not listed; a command in no group
is listed under "Other", and a test fails until it has one. Above the groups:
the description and a docs link. Below: `Usage: ork <command> [flags]`,
`Use "ork <command> --help" for more about a command.`, and the version.

A command with subcommands (`worktrees`, `projects`, `context`, `feedback`,
`agents`) shows `ork <name> <command> [flags]` in its usage line instead of
citty's list of names.
