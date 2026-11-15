# Tab completion

Press Tab after `ork` to complete commands, flags and the values you would
otherwise copy from `ork ps`: workflow names, run ids, node ids and the ids of
open decisions. It works in zsh, bash and fish. Ork prints the script; you put
it where your shell loads it. Ork never edits your shell's files. `--plain`
(plain output, [the terminal](./terminal.md)) completes with every command.

## Turn it on

**zsh.** Save the script as `_ork` in a folder on your `fpath`, then open a new
shell:

```sh
mkdir -p ~/.zsh/completions
ork completion zsh > ~/.zsh/completions/_ork
```

The folder has to be on your `fpath` before `compinit` runs. If it isn't, add
this to `~/.zshrc`, above the `compinit` line (or above your plugin manager,
which runs it):

```sh
fpath=(~/.zsh/completions $fpath)
```

Or load the script each time instead, after `compinit`, in `~/.zshrc`:
`source <(ork completion zsh)`.

**bash.** Add this to `~/.bashrc`:

```sh
eval "$(ork completion bash)"
```

The bash that comes with macOS, 3.2, loads nothing from
`source <(ork completion bash)`, and prints no error. Save the script to a file
and `source` that file instead, which works in every version:

```sh
ork completion bash > ~/.ork-completion.bash
echo 'source ~/.ork-completion.bash' >> ~/.bashrc
```

**fish.** Save the script where fish looks for completions:

```sh
ork completion fish > ~/.config/fish/completions/ork.fish
```

The script asks `ork` for every candidate as you type, so new commands, flags
and values complete as soon as you upgrade. Only a change to the script itself
needs a new copy: [What's new](../whats-new.md) says so with an "Upgrade:" line,
and then you run the command that saved it again. The `eval` and `source <(…)`
lines load the new script in your next shell on their own.

## Short flags

Nine flags have a one-letter form, and a letter means the same flag in every
command that has it:

| Short | Flag        | For example                     |
| ----- | ----------- | ------------------------------- |
| `-a`  | `--all`     | `ork logs -f -a`                |
| `-d`  | `--detach`  | `ork run build -d`              |
| `-f`  | `--follow`  | `ork logs -f`, `ork decide -f`  |
| `-i`  | `--input`   | `ork run plan -i brief="…"`     |
| `-m`  | `--message` | `ork chat <run> <node> -m "…"`  |
| `-n`  | `--limit`   | `ork ps -n 5`                   |
| `-o`  | `--output`  | `ork feedback export -o f.json` |
| `-p`  | `--project` | `ork ps -p all`                 |
| `-y`  | `--yes`     | `ork upgrade -y`                |

`-h` is help and `-v` the version. Booleans combine (`ork logs -fa`), and a
value can follow its letter directly (`-n5`). Every other flag is long only;
`ork <command> --help` shows each command's letters beside its flags. Tab
completes the long names; type a letter yourself.

## What it completes

- **Commands**, nested ones too (`ork worktrees remove`, `ork feedback apply`).
  zsh labels the menu with the groups `ork --help` shows them in.
- **Flags** of the command you're typing, with what each does. A flag's value
  completes written `--flag value` or `--flag=value` (`--input=`, `--node=`,
  `--driver=`).
- **Workflows** after `ork run` and `ork validate`: your project's, by name, and
  Ork's own `ork:` ones.
- **Run ids** after `ork logs`, `attach`, `tree`, `resume`, `stop`, `pause`,
  `continue`, `chat` and `decide`, newest first, with each run's workflow and
  status. The project you're in comes first; type a prefix to reach another
  project's run.
- **Node ids** after `--node`: the run's nodes (the newest run's when you give
  none), or the workflow's for `ork run <workflow> --node`.
- **Input names** after `--input`: `ork run <workflow> --input` offers the
  workflow's inputs as `name=`, with each one's description, and
  `ork resume <run> --input` the run's. No space follows the `=`, so you type
  the value next (in bash 4 and later; macOS's bash 3.2 adds one).
- **Open decisions** after `ork decide --id`.
- **Follow-ups** after `ork run <workflow> --follow-ups`: `due` (every due agent
  follow-up), then the project's open agent follow-ups by id, with each title
  (one short line) beside it. Type the next id after a comma yourself, or repeat
  the flag.
- **List filters**: each list's flags, the values of `--status`, `--kind`,
  `--severity`, `--due` and `--source`, and your registered projects after
  `--project` and `--for` ([filtering lists](./filtering-lists.md)).
- **Drivers** after `--driver`: `claude-code`, `open-code` or `command-code`.

Values are read from your project and Ork's store on your machine. Completing
never changes either, never shows a prompt or an output, and offers nothing
rather than an error when it can't read them. `ork completion zsh | head -1`
exits quietly too: a reader that closes the pipe early is not an error.
