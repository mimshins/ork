# Next release

_Part of [What's new](../whats-new.md)._

What lands on `main` is listed here until it ships.

- **A leader's `questions: owner` now forks the leader when it has its own
  worktree.** A leader on the default `worktree` isolation failed the fork's
  plan, so its children's questions went to you with no fork and no word of why.
  The fork now starts from the leader's worktree and answers, or passes the
  question on, as the guide says
  ([questions to a leader](../guides/leaders-and-delegation/messages-questions-and-budget.md)).
  Upgrade: none required; a leader whose questions used to reach you may now be
  answered by its fork first.

- **The `omp` driver is proven.** A capped run on a real `omp` (18.22.2, signed
  in with a Claude subscription) passed, so `ork validate` and `ork run` no
  longer refuse a node on `omp`, and `ork doctor` shows it `ok` when `omp` is
  signed in. A run that names no driver still takes `claude-code`, `open-code`,
  `command-code` or `codex` first when one is ready; name `omp` (`driver: omp`,
  `--driver omp` or `omp.<model>`) to use it. A pause past 9 minutes ends the
  stretch and resumes it on `continue`, as measured; the dollars from a
  subscription login are notional; `omp` has no turn limit, so `maxTurns` is
  still refused ([omp](../guides/drivers/omp.md)). Upgrade: a machine with only
  `omp` signed in now runs nodes that name no driver on it.
