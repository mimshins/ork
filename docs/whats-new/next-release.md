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

- **A field's problem is read with its control, and Effort no longer repeats
  Model's hint.** In the Builder, a field the checks refuse is now marked
  invalid and described by its problem, so a screen reader says why when you
  focus it. A problem on a whole list, record or group is still plain text, and
  none is announced as it appears. A node's Effort hint now points to Model's
  instead of repeating its list of `{{…}}` templates
  ([Keys and accessibility](../guides/browser-view/keys-and-accessibility.md)).
  Upgrade: none required.

- **`extract` takes what models keep sending.** `search` now accepts a `glob` (a
  file filter), `context` (lines around each hit), `regex` (`false` searches
  plain text), `max` (for `maxMatches`; over 200 is cut to 200) and several
  space-separated paths in `path`; `count` accepts and ignores a `path`. A
  `search` path that does not exist is refused as
  `no such file or folder: <path>` and filed as the agent's mistake, not an Ork
  bug, and a search where git only warns returns `[no matches]` instead of
  failing
  ([skills and context](../guides/skills-and-context.md#reading-part-of-a-file-extract),
  [reading feedback](../guides/feedback/reading.md)). Upgrade: a `files` `glob`
  without a `/` (`*.ts`) now matches names at any depth, so it can return more
  files than before; add the folder (`src/*.ts`) to match the whole path.

- **A sub-agent on another driver fails its leader, and `ork logs` says why a
  session started fresh.** A sub-agent whose rendered `model` names another
  driver than its leader's session (`open-code.x` under `claude-code`, whether
  the driver comes from the model, `--driver` or the ready one) used to lose its
  prefix without a word; it now fails the leader's node, naming both drivers, in
  `ork run`, `ork run --node` and `ork chat`. A start that began fresh because
  the driver changed prints
  `starts a fresh session: driver changed from <from> to <to>` under the start
  line, in `ork logs` and the live stream; `--json` is unchanged
  ([choosing a model](../guides/writing-workflows/choosing-a-model.md#a-model-on-another-driver)).
  Upgrade: a workflow whose sub-agent model rendered another driver's prefix now
  fails; drop the prefix or use the leader's driver. A session recorded before
  this fix may have dropped the prefix too, so `ork chat` on it now refuses when
  the sub-agent's model clashes with the session's driver.

- **The npm page and docs name all five drivers.** The `@krapht/ork` page on npm
  now names Codex and `omp` beside Claude Code, OpenCode and Command Code, lists
  `ork onboard`, and says `omp` is built but not yet proven, so a run refuses
  it. The installation guide lists every driver and asks for `opencode` 2.3.2 or
  later, and [SECURITY.md](../../SECURITY.md) says how `codex` and `omp` are
  given Ork's token and what removes it ([Drivers](../guides/drivers.md)).
  Upgrade: none required.
