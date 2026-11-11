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

(The bash that comes with macOS, 3.2, can't `source <(…)`. Saving the script to
a file and adding `source` of that file works in every version.)

**fish.** Save the script where fish looks for completions:

```sh
ork completion fish > ~/.config/fish/completions/ork.fish
```

Run the same command again after `ork upgrade`, so the script keeps up with the
commands.

## What it completes

- **Commands**, nested ones too (`ork worktrees remove`, `ork feedback apply`).
  zsh labels the menu with the groups `ork --help` shows them in.
- **Flags** of the command you're typing, with what each does.
- **Workflows** after `ork run` and `ork validate`: your project's, by name, and
  Ork's own `ork:` ones.
- **Run ids** after `ork logs`, `tree`, `resume`, `stop`, `pause`, `continue`,
  `chat` and `decide`, newest first, with each run's workflow and status. The
  project you're in comes first; type a prefix to reach another project's run.
- **Node ids** after `--node`: the run's nodes (the newest run's when you give
  none), or the workflow's for `ork run <workflow> --node`.
- **Open decisions** after `ork decide --id`.
- **Drivers** after `--driver`: `claude-code`, `open-code` or `command-code`.

Values are read from your project and Ork's store on your machine. Completing
never changes either, never shows a prompt or an output, and offers nothing
rather than an error when it can't read them.
