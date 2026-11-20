# Next release

_Part of [What's new](../whats-new.md)._

- **No false "limit is close" warning.** Claude Code 2.1.329 marks its limit
  event as a warning while the window it names says `allowed` (seen at 31% of
  the seven-day window), so every run showed `! plan: seven day limit is close`.
  Ork now takes the window's own status, and warns only when the window itself
  does
  ([across runs and time](../guides/models-and-budgets/across-runs-and-time.md)).
