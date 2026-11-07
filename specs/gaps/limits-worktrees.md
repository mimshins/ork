# Limits: the Worktrees panel

_Part of [Known gaps and limits](../gaps.md)._

How the [Worktrees panel](../ui/panels.md#worktrees) and
[`ork worktrees remove`](../worktrees.md#ork-worktrees) work for now, by choice.

- **L155 · The Worktrees panel reads git when asked, not as it changes.** It
  reads every project when it shows, after each remove or clean, on Reload, and
  when the runs change while it shows, at most every 5 s. An edit or a commit in
  a worktree outside Ork shows on Reload. Watching each project's
  `.git/worktrees` and refs would let it follow git itself.
- **L156 · Clean merged… cleans only what's merged, never forced.** The panel
  has no `clean --all`, `--force` or `--run`: unmerged or dirty work goes one
  row at a time, through Remove…'s explicit confirm. A Monitor action "Clean
  this run's worktrees…" could take `--run` later.
- **L157 · One write per project is held only within `ork ui`.** The server
  refuses a second remove or clean in a project while one runs, but an
  `ork worktrees clean` in a terminal at the same time isn't kept out. Git's own
  lock still takes one command at a time, and the digest refuses a plan that
  changed.
- **L158 · After the last row goes, the focus goes to the panel.** Removing the
  last item puts the focus on the panel itself, which then shows the empty
  state, rather than on the empty state's title, which isn't focusable.
