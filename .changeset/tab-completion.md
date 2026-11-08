---
"@krapht/ork": minor
---

Tab completion for zsh, bash and fish: `ork completion <shell>` prints a script
that completes commands, flags, workflow names (with `ork:` ones), run ids
newest first with their workflow and status, node ids after `--node`, open
decision ids after `ork decide --id`, and `--driver` values. The script asks the
hidden `ork __complete`, which reads the project and the store read-only and
prints nothing when it can't. `ork --help` now lists the commands in groups (Get
started, Workflows, Runs, Steer a running run, After runs, Projects, Ork itself)
with a short line each, `wt` shown as `worktrees`' alias, and a command with
subcommands shows `<command> [flags]` in its usage line.
