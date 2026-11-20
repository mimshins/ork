# Next release

_Part of [What's new](../whats-new.md)._

What lands on `main` is listed here until it ships. Permissions are described in
[permissions without asking](../guides/permissions.md).

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

- **Reads Ork knows are allowed without a question.** On `claude-code`, a shell
  line is read through loops, subshells and wrappers such as `timeout`, and
  allowed when every command is covered by the node's rules or by Ork's own
  reads: `ork logs`, `ps`, `tree`, `usage`, `feedback list|show`,
  `follow-ups list|show`, `jq`, `wc`, `cut`, `sort`, `uniq`, `head`, `tail`,
  `tr`, `ls`, `echo`, `printf`, `pwd`, `basename`, `dirname`, `date`, `cd`,
  `true` and `false`, each without a flag that writes a file or runs a program.
  A path outside the session's folder still asks. The Codex, Command Code and
  omp guards read loops and subshells the same way, without the new list.
- **A read-only node is refused, not asked.** A shell command its rules do not
  allow comes back to the session as a message naming what it may run, so nobody
  waits. Upgrade: a read-only node that relied on being asked about, say,
  `pnpm test` is now refused until it has an `allow` rule for it or you set
  `unlisted: ask` (a node's `tools.unlisted`, a workflow's
  `rules.permissions.unlisted`, or the project's `permissions.unlisted`; the
  node wins over the workflow, which wins over the project).
- **Allow for this node, this run or always.** A permission for a shell line Ork
  can read offers those answers beside Allow and Deny, in the terminal,
  `ork decide`, the browser and Ork's MCP tools, each showing the rule it adds.
  "Always" adds it to `permissions.allow` of `.ork/project.yaml` (or
  `~/.ork/projects/<id>/project.yaml`) and keeps the file's comments.
- **Rules Ork suggests.** A rule you allow again and again, 3 times across 2
  runs, becomes a `permission.suggest` feedback item naming the rule and the
  file to add it to; Ork writes nothing.
