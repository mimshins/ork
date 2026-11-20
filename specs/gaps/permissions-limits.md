# Limits found building permissions without asking

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building the shell reader, the shipped reads, refusal, scopes and
suggestions ([permissions without asking](../project-rules/permissions.md),
[ADR-109](../../decisions/ADR-109-permissions-without-asking.md)). What was left
simpler, or could not be checked:

- **L503 · The shipped reads are a list Ork keeps true by hand.** Each program's
  refused forms (`sort -o`, `tail -f`, `jq -f`, …) are written against today's
  flags. A new release of one of them that gains a flag which writes a file or
  runs a program would be allowed until the list learns it. A check that
  compares the list with each tool's `--help` would catch it.
- **L504 · Only shell lines are refused.** The reader reads `Bash` calls only,
  so a read-only node's WebFetch, MCP, `Edit` or `Write` call outside its rules
  still asks a person, even under `unlisted: refuse`; so does a line the reader
  cannot read.
- **L505 · A refused call never becomes a prompt.** A session that keeps
  retrying a refused command is bounded only by its `maxTurns` and the budget,
  by choice; no count of refusals escalates to the person.
- **L506 · Permissions without asking are `claude-code`'s only.** Codex,
  OpenCode, Command Code and omp have no prompt to answer
  ([L234](../gaps.md#limits)): they get no refusal message, no scopes, no
  "always" and no suggestions, and their guards use the shell reader but not the
  shipped reads. Their refused calls are not counted toward a suggestion either.
- **L507 · The suggestion threshold is unmeasured.** 3 allows across at least 2
  runs (`suggest-thresholds.ts`) is a first guess; it waits for counts from real
  runs.
- **L508 · `pnpm ork` runs the project's own script.** The shipped reads take
  `pnpm ork logs` and its siblings as Ork's reads, but `pnpm` runs whatever the
  project's `package.json` names `ork`. A node that can edit `package.json` can
  change what those shipped commands run for every node that works in that
  checkout afterwards. `pnpm -s ork` forms run it the same way. Whether to drop
  them from the shipped reads is the maintainer's to decide.
- **L509 · `cd` is modelled two levels deep.** The reader follows a `cd` into a
  folder through two link-out passes; three or more levels of `cd` through links
  out of the checkout are not modelled, and such a line asks a person.
- **L510 · A decision's context is cut at 4000 characters.** A longer one is
  shortened in the question; the answer is still read against the full call, so
  a cut context asks again rather than allows, which is safe.
- **L511 · The other drivers' guards now read loops, by the whole command.**
  Codex, Command Code and omp check each command of a loop, subshell or `if`
  against the node's rules, so a loop they refused before runs when each of its
  commands is allowed. They match each command as written, wrappers included:
  `timeout 60 git push` is not caught by a deny rule on `git push` there, as it
  is by the `claude-code` verdict, and needs a rule on `timeout` to be allowed.
- **L512 · A generalised rule does not always cover its own source line.** The
  rule offered for `git -C x log` is `Bash(git log *)`, which does not match
  that line, so choosing "always" does not stop the next prompt for that form,
  and a node or run scope allows `git -C <any folder> log` afterwards.
