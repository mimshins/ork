# Working in an Ork session

Every node of this project's workflows reads this file (`context:` in
`.ork/project.yaml`).

- Change files with Edit and Write, never with a python, node or `sed -i` script
  or a heredoc: Claude Code asks about those even with Bash allowed, and the run
  waits for the maintainer.
- Bash may run in zsh, so quote a glob or pattern (`--include='*.ts'`, not
  `--include=*.ts`, which fails with "no matches found") and start no word with
  `=` (`echo ====` fails with "=== not found").
