# Next release

_Part of [What's new](../whats-new.md)._

- **Sessions get an `extract` tool, so a read does not stay in the
  conversation.** It reads a range of lines, searches, or shows a `git` diff,
  `show` or `log`, then cuts the text with `head`, `tail` or `match`, and
  returns only that, up to 16,000 characters with a footer
  (`[extract: read N characters, returned M]`). It refuses a path outside the
  session's folder and secret-looking files (`.env*`, keys, `.npmrc`, `.git/`,
  and what `tools.deny` or the project's `.claude/settings.json` denies with
  `Read(...)`). Ork's notes to every node now tell it to prefer `extract` over
  `cat`, `sed`, `rg` and whole-file reads
  ([guide](../guides/skills-and-context.md#reading-part-of-a-file-extract)).
- **`pnpm benchmark` also writes `carried.json`.** It measures how much of each
  tool result a session rereads (characters times later turns), by role and kind
  of call, with turns per session and the calls to `extract`, when the sessions'
  transcripts are on the machine; `pnpm benchmark:carried <run>` prints it
  alone, and `pnpm benchmark:publish` copies it
  ([method](../../benchmarks/method.md#carried-weight)).
- **`ork onboard` offers to resume a proposing run that did not finish.** When
  the newest proposing run in the project failed, was stopped or crashed, and
  `ork resume` could continue it, the next `ork onboard` shows its age, id,
  status and what it spent, and asks to resume it: yes continues that same run
  and skips the questions, no or `--fresh` starts as before
  ([guide](../guides/onboarding.md#a-saved-proposal)).
- **`ork onboard`'s gate lists a deleted node once.** A node the writer removed
  reads `node <id> removed` instead of a `removes` line per field, and a field's
  value that contains the words "changes … to" no longer hides a real change
  ([guide](../guides/onboarding/the-gate-and-its-checks.md#the-gate)).
- **`ork onboard`'s survey says `no commits` for a repository with none.** It
  used to say `unavailable`, which is now only for a folder git cannot read
  ([guide](../guides/onboarding.md#what-it-does-in-order)).

- **`ork onboard`'s gate lists less, and more of what matters.** The "needs your
  eye" list no longer names plain reads (`Read`, `Glob`, `Grep`, `LS`,
  `NotebookRead`); any other tool name is listed, and so is a rule Ork cannot
  read. It now also lists a change, against what is committed, to `context`,
  `heavy`, `calls.accept`, `followUps.file`, `git`, `links`, `isolation`,
  `tools.only` and `rules.git`, and a field the writer removed that the
  committed file set had (`removes <field>`)
  ([guide](../guides/onboarding/the-gate-and-its-checks.md#the-gate)).
- **`ork onboard`'s survey includes recent history.** The last 20 commit
  subjects, the newest 10 release tags and the 10 most-changed paths of the last
  200 commits, with no author names, emails or hashes. They go to the model
  provider with the rest of the survey, with anything that looks like a secret
  masked; `unavailable` when git cannot read them
  ([guide](../guides/onboarding.md#what-it-does-in-order)).
- **`ork onboard` shows tokens only on a driver that reports no dollars.** On
  Command Code the cost line gives the token caps and says no dollars are
  reported, instead of a dollar figure the driver cannot hold
  ([guide](../guides/onboarding.md#what-it-costs)).
- **`ork onboard` offers the proposal you left at the pick.** Ctrl-C at the pick
  now prints the proposing run's id, what it spent and to run `ork onboard`
  again. The next visit in that project shows the saved proposal's age and asks
  to use it: yes skips the questions and the paid proposing run, no or `--fresh`
  starts as before ([guide](../guides/onboarding.md#a-saved-proposal)).
- **`ork onboard`'s writer knows the workflow format and what `ork init` made.**
  It gets a reference (node types, ownership, edges and `maxRounds`, gates, the
  entry node, caps, one valid workflow) and is told the starter and `.gitignore`
  line `ork onboard` just made are not in its worktree, so it stops looking for
  them.
- **`ork onboard` no longer fails on Command Code's empty `taste.md`.** The
  check on the writer's worktree ignores `.commandcode/taste/taste.md` when it
  is a new, regular, empty file; anything else there still counts as a change
  outside `.ork/`.
- **`ork:security-audit` holds each verifier's record to the report schema.** A
  check runs the skill's validator on the record and sends the verifier back
  with what it found, up to 3 tries, so a record with a missing `scope`, an
  extra field or `remediation.fixes` is fixed before it is accepted. The
  report's `run-metadata.json` now lists the previous audit's folder in
  `prior_run_paths` ([guide](../guides/security-audit.md)).
- **A `verify:` step can read the session's report.** `$ORK_REPORT` names a JSON
  file with the report, written by Ork outside the checkout with secrets masked,
  so a read-only node can be checked without a place to write
  ([guide](../guides/scripts/steps.md)).
