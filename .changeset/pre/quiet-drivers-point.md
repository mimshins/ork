---
"@krapht/ork": patch
---

Small fixes from a QA pass. `ork run`, `resume`, `chat` and `feedback apply`
list all three drivers in `--driver`'s help, and a `--driver` whose tool isn't
found is refused before the run starts, not at its first node.
`ork follow-ups add` and `post` refuse a github draft whose `to` isn't an issue
or pull request URL (and `add --channel github` no longer fills `to` with a
person's name), a step with no text, and a message without `--text`; with `gh`
signed out they print one "Can't check PRs" line; `post` without `--confirm`
shows the preview and exits 0. The panel's **Post to GitHub…** says why it is
disabled. `ork validate` reports a problem in `.ork/project.yaml` at that file's
line and column, not at the workflow's first line, and `when: timedOut` on an
edge no longer warns that the field is unknown.
