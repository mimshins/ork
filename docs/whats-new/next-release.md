# Next release

_Part of [What's new](../whats-new.md)._

What lands on `main` is listed here until it ships.

- **Plan limits say when they were seen, and old warnings stop showing.**
  `ork usage` (text and `--json`) and the Usage panel now date each plan limit
  (`seen 2h ago`). A warning seen more than 3 hours ago reads "was close …
  stale" and is dimmed; a limit the plan refused is dated but never stale. Ork
  forgets the warnings an older version stored, so a "seven day limit is close"
  left from the day before no longer shows
  ([Across runs and time](../guides/models-and-budgets/across-runs-and-time.md)).

- **The npm page and docs name all five drivers.** The `@krapht/ork` page on npm
  now names Codex and `omp` beside Claude Code, OpenCode and Command Code, lists
  `ork onboard`, and says `omp` is built but not yet proven, so a run refuses
  it. The installation guide lists every driver and asks for `opencode` 2.3.2 or
  later, and [SECURITY.md](../../SECURITY.md) says how `codex` and `omp` are
  given Ork's token and what removes it ([Drivers](../guides/drivers.md)).
  Upgrade: none required.
