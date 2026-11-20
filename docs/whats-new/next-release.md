# Next release

_Part of [What's new](../whats-new.md)._

- **A detached start waits out a slow startup, and a budget start no longer
  frees dollars for nothing.** `ork run --detach` and `ork resume --detach`
  failed with `the run did not start in time` when a driver's CLI was slow to
  answer during the start. They now wait up to two minutes while the background
  process shows it is starting, and still stop one that shows no sign of life
  for 15 seconds
  ([running in the background](../guides/running-workflows/running-and-answering.md#in-the-background)).
  A node that finds too little budget left now gives up its reserve only when
  another node's reserve can free, so with nothing to wait on its dollars stay
  set aside and a node starting beside it cannot be offered dollars the run's
  budget does not have.
- **`omp` is the fifth driver, built and not yet proven.** `omp` runs your own
  `omp` (the CLI of oh-my-pi) headless, with Ork's tools and a guard Ork writes
  to hold each node to its rules, and reaches whichever model providers your
  `omp` is signed in to. It is refused by `ork validate` and `ork run`, and
  `ork doctor` shows it as `skip`, until a real session has proven it
  ([omp](../guides/drivers/omp.md), [Drivers](../guides/drivers.md)). The
  README, the docs overview, `ork --help` and the npm description now name Codex
  and `omp` beside Claude Code, OpenCode and Command Code.
- **Feedback says why an Ork tool call failed, one item for each tool.** A
  refused or failed call of an Ork tool (`extract`, `follow_up`, …) now records
  the first line of the tool's own message, at most 300 characters, with secrets
  and your `env:` values masked, and the item is titled by the tool
  (`Ork's extract tool refused a call's arguments`), so every node that hits the
  same refusal adds to one item. Nothing another tool printed is kept
  ([feedback](../guides/feedback/reading.md#where-it-comes-from)). `extract` now
  says what to send instead when it refuses a call, takes `null` and a JSON
  string for `steps` and `programs`, and counts a regular expression git cannot
  compile as the agent's mistake, not an Ork bug
  ([the tool](../guides/skills-and-context.md)). Upgrade: items filed before
  this, one for each node, stay separate and no longer grow; resolve or dismiss
  them with `ork feedback resolve` or `dismiss`.
