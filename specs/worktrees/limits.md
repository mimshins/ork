# Limits: the Worktrees panel

_Part of [Worktrees: where nodes work](../worktrees.md)._

How the [Worktrees panel](../ui/panels-worktrees.md) and
[`ork worktrees remove`](../worktrees.md#ork-worktrees) work for now, by choice.
Those the gaps review carried are open work in the
[register](../gaps.md#limits).

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
- **L169 · An `ork/` branch no run recorded is matched by branch.** Older runs
  recorded no path, so such a branch's worktree is whichever has it checked out,
  a user's own `git worktree add ../review ork/r1/lead` included, and clean can
  remove it. Recorded items are matched by their path.
