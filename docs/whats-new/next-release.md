# Next release

_Part of [What's new](../whats-new.md)._

- **No false "limit is close" warning.** Claude Code 2.1.329 marks its limit
  event as a warning while the window it names says `allowed` (seen at 31% of
  the seven-day window), so every run showed `! plan: seven day limit is close`.
  Ork now takes the window's own status, and warns only when the window itself
  does
  ([across runs and time](../guides/models-and-budgets/across-runs-and-time.md)).

- **A remote `git.base` is fetched, and a readonly node can read a fresh base.**
  A run whose `git.base` is a remote branch such as `origin/main` now fetches
  that one branch before it starts, so its worktrees begin from the remote's
  newest commit instead of whatever your clone last fetched. A fetch that fails
  stops the run before any node and names git's reason. The new rule
  `git.readonly: base` gives a `readonly` node with no owner and no input's
  worktree one shared worktree at the base commit, not your checkout, so
  reviewers and auditors stop reading the wrong branch; it is off by default,
  and the refresh step and stub worktree node that attached projects used as a
  workaround can go ([a fresh base](../guides/worktrees/fresh-base.md)).
  Upgrade: a run with a remote `git.base` now fetches it; if you work offline or
  have no access to the remote, set `git.fetch: never` in `.ork/project.yaml` to
  keep the old behavior.

- **A message to an `omp` node arrives before the turn ends, and a long pause
  costs one resume.** The `omp` driver now keeps one `omp --mode rpc` process
  for each stretch and talks to it both ways. `ork chat` and `ork send` reach
  the model before the turn ends (a tool call that is running finishes first), a
  stop aborts the turn, and a permission question from `omp` comes to you in
  `ork decide` (Ork never answers "approve for this session"). The session ends
  when `omp` says it has settled, not at the end of the first turn. When a
  paused node's call has waited 9 minutes, Ork now ends the stretch, and
  `ork continue` resumes the session with a message asking the model to make the
  held call again, instead of refusing the call every hour at the cost of a
  model request each time. `omp` is still built and not yet proven, so
  `ork validate` and `ork run` still refuse it ([omp](../guides/drivers/omp.md),
  [Drivers](../guides/drivers.md)). Upgrade: none required.
