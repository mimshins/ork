# Next release

_Part of [What's new](../whats-new.md)._

- **A node you stopped mid tool call reads "was stopped".** Stopping a node with
  `ork stop` while its agent was in a tool call could end the agent's session as
  "ended for a reason Ork doesn't recognize" and file a bug, because Claude Code
  prints an error result when it is cut off. A session Ork stopped that had not
  handed in a report now ends as interrupted, on every driver; a report it had
  handed in still decides
  ([why a node stopped](../guides/why-a-node-stopped.md#interrupted)).
- **`ork onboard` checks the writer's files in a subfolder project.** When your
  project is a subfolder of its git repository, the check after the writer ran
  named paths from the repository's top, so it refused a workflow in the
  project's own `.ork/workflows/` and let a `.ork/project.yaml` at the
  repository's root pass as if it were the project's. It now reads, commits and
  checks the project's files from the project folder, and refuses a change
  outside it
  ([what it does, in order](../guides/onboarding.md#what-it-does-in-order)).
- **OpenCode 2.3.2 or later.** `ork doctor` warns about an older `opencode`,
  whose sessions never saw Ork's tools, and the `open-code` driver is not ready
  until you run `opencode upgrade`. On OpenCode, a shell line that pipes through
  `head`, `tail`, `sed`, `awk` or `grep` is no longer refused, since OpenCode
  checks every command of a line; reading a file with `cat`, `find`, `rg` or
  `git diff` still is. Upgrade: run `opencode upgrade` if you use the
  `open-code` driver.
