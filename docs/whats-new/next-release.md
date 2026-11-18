# Next release

_Part of [What's new](../whats-new.md)._

- **A fourth driver, `codex`, is built but not proven yet.** It runs your own
  OpenAI `codex` (0.169.0 or later), one `codex exec` for each stretch of a
  session, with Ork's tools, a sandbox and a hook Ork writes per session that
  holds the node to its `allow`, `deny` and `only` rules (denied unless
  allowed). The id (`driver: codex`, `--driver codex`, `codex.<model>`) is
  accepted by the workflow schema and by tab completion, but until the
  maintainer's capped run on a real `codex`, `ork doctor` shows the driver as
  `skip`, and both `ork validate` and `ork run` refuse a node that names it as
  "not yet proven on a real session". It reports tokens and no dollars, takes a
  message when a stretch ends, and refuses a node that needs `mcp` servers,
  sub-agents, `maxTurns` or a `deny` on a `Read`, `Glob` or `Grep` path. A
  `readonly` node runs in Codex's read-only sandbox, so it can't run a command
  that writes files. A user or system `hooks.json` ends its node before it
  starts; a Codex that runs tools without Ork's hook is stopped at the first
  one; and its skills stay visible ([Codex](../guides/drivers/codex.md),
  [the limits](../../specs/gaps/codex-limits.md)).
- **A node you stopped mid tool call reads "was stopped".** Stopping a node with
  `ork stop` while its agent was in a tool call could end the agent's session as
  "ended for a reason Ork doesn't recognize" and file a bug, because Claude Code
  prints an error result when it is cut off. A session Ork stopped that had not
  handed in a report now ends as interrupted, on every driver; a report it had
  handed in still decides
  ([why a node stopped](../guides/why-a-node-stopped.md#interrupted)).
- **`ork stop` ends a node waiting for a slot at once, and never resumes a
  stopped one.** A session that was held for a heavy slot kept waiting for the
  slot after you stopped the run; it now ends as interrupted immediately and
  gives the slot back. A session Ork stopped is never resumed.
- **`ork onboard` no longer refuses Command Code's empty taste file in a
  subfolder project.** The writer runs at the repository's top, so Command Code
  leaves its empty `.commandcode/taste/taste.md` there, and the check refused it
  as a file outside your project. It now skips that exact file, when it is new
  and empty, as it does at a repository's root
  ([what is checked](../guides/onboarding/the-gate-and-its-checks.md#what-is-checked-and-what-is-only-asked-for)).
  The writer is still not told your project's folder, so it may write its
  workflows at the top, where the check refuses them
  ([L437](../../specs/gaps/onboard-limits.md)).
- **`ork onboard`'s check works on git older than 2.28.** It used
  `git diff --no-relative`, which older git does not know; it now sets
  `diff.relative` through `-c`, which any git accepts and which also ignores a
  `diff.relative` setting of yours.
- **`ork onboard` checks the writer's files in a subfolder project.** When your
  project is a subfolder of its git repository, the check after the writer ran
  named paths from the repository's top, so it refused a workflow in the
  project's own `.ork/workflows/` and let a `.ork/project.yaml` at the
  repository's root pass as if it were the project's. It now reads, commits and
  checks the project's files from the project folder, and refuses a change
  outside it
  ([what it does, in order](../guides/onboarding.md#what-it-does-in-order)).
- **An agent's bad tool call is no longer filed as an Ork bug.** When an agent
  called one of Ork's tools with arguments it refused, `ork feedback` listed it
  as a bug in Ork. It is now the agent's context gap (`tool.arguments`), on
  Claude Code and OpenCode, and the tool's answer starts with "Invalid
  arguments, nothing ran:". The same holds for what `extract` refuses once it
  runs: a missing file, a refused path or a `rev:path` revision.
- **OpenCode 2.3.2 or later.** `ork doctor` warns about an older `opencode`,
  whose sessions never saw Ork's tools, and the `open-code` driver is not ready
  until you run `opencode upgrade`. On OpenCode, a shell line that pipes through
  `head`, `tail`, `sed`, `awk` or `grep` is no longer refused, since OpenCode
  checks every command of a line; reading a file with `cat`, `find`, `rg` or
  `git diff` still is. Upgrade: run `opencode upgrade` if you use the
  `open-code` driver.
