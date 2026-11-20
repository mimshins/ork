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

- **Reads through `pnpm ork …` are no longer Ork's own reads.** `pnpm ork logs`
  and `pnpm -s ork logs` (and the other reads, with `--silent` too) used to be
  allowed without a question on `claude-code`, because Ork treated them as
  `ork logs`. pnpm runs whatever the project's `package.json` calls `ork`, so a
  node that edited it could change what a later read ran. Only the installed
  `ork` is covered now
  ([permissions](../guides/permissions.md#reads-ork-already-knows)). Upgrade: a
  node that read through `pnpm ork …` is now asked or refused; use `ork …`, or
  allow `Bash(pnpm -s ork logs *)` for the node.

- **`codex`, `command-code` and `omp` allow Ork's reads without a rule.** A
  shell line whose every command is covered by an `allow` rule or is one of
  Ork's own reads or a filter such as `jq`, `wc` or `head`, with each path
  inside the worktree and no `cd` or expansion, is allowed, so these nodes are
  refused less often. `open-code` is not changed: it still needs a rule for each
  read ([Drivers](../guides/drivers.md#permissions-denied-unless-allowed)).
  Upgrade: none required.

- **A tool refused 3 times in one node is feedback.** On `codex`, `open-code`,
  `command-code` and `omp`, the third refusal of the same tool by one node files
  one `tool.refused` item that names the tool, shared by every node, with what
  to do: add the rule to the node's `tools.allow` or say in its prompt not to
  use the tool ([feedback](../guides/feedback/reading.md#where-it-comes-from)).
  Upgrade: none required.

- **`omp` takes Ork's tools over its own pipe, and a wrong model name stops the
  run early.** Ork's tools now reach `omp` as host tools on the session's pipe,
  so the private plugin folder, its `.mcp.json` and the `MCP servers not ready`
  failure are gone, and the session's token sits in one file that opens only the
  guard's endpoint. `ork run` and `ork resume` refuse a node whose exact
  `omp.<provider>/<model>` is not in `omp models --json`, naming the node and
  the model, before anything is spent; fuzzy names, roles and templated models
  are not checked, and `ork validate` stays offline. A resumed `omp` session
  tells the model the real reason its call did not run, a pause or a `heavy`
  slot that was not free, where it always said the node was paused. `omp` stays
  unproven, so a run still refuses it
  ([omp](../guides/drivers/omp.md#if-a-node-stops-before-it-starts)). Upgrade: a
  model name that `omp` resolves fuzzily but `omp models` does not list exactly
  (`omp.openai/gpt5`) is now refused; write the exact form `omp models` shows.

- **The npm page and docs name all five drivers.** The `@krapht/ork` page on npm
  now names Codex and `omp` beside Claude Code, OpenCode and Command Code, lists
  `ork onboard`, and says `omp` is built but not yet proven, so a run refuses
  it. The installation guide lists every driver and asks for `opencode` 2.3.2 or
  later, and [SECURITY.md](../../SECURITY.md) says how `codex` and `omp` are
  given Ork's token and what removes it ([Drivers](../guides/drivers.md)).
  Upgrade: none required.
