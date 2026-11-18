# Limits found building `ork onboard`

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found planning and building [`ork onboard`](../cli/onboard.md)
([RFC-018](../../rfcs/archived/RFC-018-onboard.md)). What was left simpler, or
could not be checked:

- **L390 · An attached project is refused.** `ork onboard` stops in a project
  `ork register` attached and names `ork migrate`, since its writer works on a
  branch of the repository and attached workflows live outside it. Kept by
  [ADR-099](../../decisions/ADR-099-onboard-refuses-attached-projects.md): if
  attached users ask, the writer gets a worktree seeded with the attached files
  and Ork copies the result back on keep (RFC-022's option D).
- **L391 · A crash inside the survey or the three questions starts over.** A
  proposal left at the pick, and a propose run that failed, stopped or crashed,
  are found again in the store
  ([a saved proposal](../cli/onboard-saved.md#a-saved-proposal),
  [an unfinished proposal](../cli/onboard-saved.md#an-unfinished-proposal)), but
  the survey and the questions run before any run exists and nothing is kept of
  them, so a crash there asks again. Closing it needs a state file or an event
  type, which were ruled out for now.
- **L392 · The follow-up question cap is a prompt.** `ork:onboard-propose`'s
  prompt asks for at most three `ask_user` questions, and `maxTurns` bounds it;
  the format has no field that counts a node's questions.
- **L393 · `layers.project: ignore` does nothing on `open-code` and
  `command-code`.** Only the Claude Code driver passes the session settings that
  carry it, so the repository's `AGENTS.md` (both) and Command Code's
  `.commandcode/skills` and `.commandcode/agents` load, and nothing warns:
  `ork validate --driver` has no capability for it. Command Code also loads the
  machine's own skills, memory and mods
  ([what a session loads](../runtime/what-a-session-loads.md)).
- **L394 · Ignoring the project layer leaves Claude Code's project settings
  on.** `.claude/settings.json` and `settings.local.json` still load (the
  session's `settingSources` stay `[project, local]`, which is what
  `--setting-sources project,local` passes), with their permissions and hooks,
  so a cloned project's hook runs in an onboarding session as in any run.
- **L395 · The writer is held to `.ork/` by a check, not a sandbox.** `finish`
  refuses a change outside `.ork/workflows/*.ork.yaml` and `.ork/project.yaml`
  that lands in the writer's worktree, ignored paths included (`--ignored`),
  except an ignored file Ork copied into the worktree that is unchanged from the
  project root's (so a copied file rewritten with identical bytes is not seen),
  and the empty `.commandcode/taste/taste.md` Command Code makes (a regular file
  of size 0, a new entry only; anything else at that path still fails); a bare
  `Edit` or `Write` allow is not held to the worktree (G14), so a write outside
  the worktree is still not seen. The gate says so.
- **L396 · Cited feedback ids are not checked.** A suggestion's `feedback` ids
  pass the filter unchecked and are only listed when kept; none is resolved.
- **L397 · `ork init`'s `.gitignore` edit stays outside the branch.** When
  `ork onboard` sets `.ork/` up, the `.gitignore` entry is left uncommitted in
  the working tree, and the closing text says to commit it with the branch.
- **L398 · A suggestion can't be declared field by field.** An agent's list item
  holds only scalars (L358), so the proposer reports `{ list: {} }` and only the
  filter holds each item to `SuggestionSchema`; the driver sees no item shape.
- **L399 · The proposer's reads are not held to the project.**
  `ork:onboard-propose` allows `Read`, `Grep` and `Glob` by bare name, since
  OpenCode refuses `grep` and `glob` unless allowed (L236). On `claude-code` and
  `command-code` a bare allow also covers paths outside the checkout (`~/.ssh`,
  `~/.aws`), so the proposer can read them with no prompt, and what it reads
  reaches the model provider. Only its prompt keeps it to the project; OpenCode
  still refuses a path outside the worktree. The same class as G14 for the
  writer's `Edit` and `Write`.
- **L400 · A first visit warns of uncommitted files.** The `.ork/` that
  `ork onboard` sets up, and its `.gitignore` edit, are uncommitted, so each of
  the two runs prints
  `warning N uncommitted change(s) in this checkout are not in the worktrees`.
  It is harmless, since the writer only adds files, but it reads as a problem.
  Committing the set-up first, or leaving it out of the warning, would close it.
- **L401 · The filter skips a package script behind a flag.** A drafted line
  whose first word after the manager is a flag (`pnpm -r nope`,
  `npm --silent run x`) is not checked against `package.json`'s scripts, since
  the filter cannot tell the flag's value from the script name; its program is
  still checked. Parsing each manager's flags would close it.
- **L402 · `.ork/project.yaml` may set a `driver` or `model` for every
  workflow.** `defaults.driver` and `defaults.model` there apply to every
  workflow, so the rule that written workflows name neither also holds for the
  project file. `finish` checks the workflow files for it and only lists the
  project file's `defaults` at the gate, so a `driver` or `model` there is
  shown, not refused. Refusing it in `finish` would close it.
- **L403 · A crash inside `finish` exits 1 and loops like a problem.** The
  `finish -> write` edge fires on `exitCode == 1`, which is what `finish` exits
  when it finds problems and also what an uncaught Node error exits. A bug in
  `finish` reads as the writer's mistake and costs up to three more rounds. A
  distinct exit code for a crash would close it.
- **L404 · A hook that rewrites the canonical commit fails the run after 3
  rounds.** `finish` commits the serialized workflows with the repository's
  hooks running, then reads them again; a hook that reformats them is a problem
  the writer cannot fix, so the writer is sent back three times and the run ends
  failed. Hooks keep running (no `--no-verify`); the person sees which file a
  hook rewrote.
- **L405 · Standalone `ork:onboard-propose` returns the unfiltered list.** Only
  `ork onboard` checks the proposer's `suggestions` (evidence, commands, names)
  now, in its own process. `ork run ork:onboard-propose` returns the list as the
  model wrote it, with nothing dropped.
- **L406 · The survey's lists are capped without a count.** Scripts keep 30,
  test and check commands 20 each, CI files 20 and the names under `.ork/` 20,
  with no `and N more`; only the agent and skill folders say how many were left
  out. The proposer cannot tell a short list from a cut one.
- **L407 · The survey text is cut from the end.** `surveyText` stops at 6,000
  characters, so a crowded repository loses the last lines first, and the
  `.ork/` line, which review mode needs, is the last. It cuts by UTF-16 unit and
  can split a surrogate pair. The history digest (L412) comes after the `.ork/`
  line, so a cut takes it first, but a long enough list still pushes `.ork/`
  out. Trimming each list would close it.
- **L408 · The survey reads only the root `package.json`, and treats manifests
  as lockfiles.** A workspace's own scripts, `pyproject.toml`, `tox` and
  `pytest` commands are not read, so `uv`, `poetry`, `maven`, `gradle` and
  `bundler` name a manager and give no test or check command. `Cargo.toml`,
  `pom.xml` and `build.gradle` are manifests, not lockfiles, and name their
  manager anyway.
- **L409 · Makefile targets are matched by exact name.** Only `test`, `tests`,
  `check`, `lint`, `ci` and `verify` count: `test-unit:` does not. A repository
  with a `package.json` and no lockfile or `packageManager` is assumed to use
  `npm`.
- **L410 · CI detection knows a fixed list of files.** GitHub workflows, GitLab,
  CircleCI, Jenkins, Azure, Buildkite and Bitbucket are found, `.travis.yml`,
  `appveyor.yml` and `.drone.yml` are not; and a folder named `Jenkinsfile`
  counts as one.
- **L411 · A few `.ork/` facts are read loosely.** A `.ork/` that is a link out
  of the repository reports `exists: true` while holding nothing, and a folder
  named `project.yaml` counts as the project file.
- **L412 · The survey's history digest is subjects only, and bounded.** It holds
  the last 20 commit subjects, the newest 10 release tags and the 10 most
  changed paths over the last 200 commits, each cut to 60 or 100 characters; no
  author, email or hash. The proposer cannot see a commit's body, its authors or
  what changed in it, a repository with fewer than 20 commits or no tags says
  `none`, and one with no commits says `no commits` (only where the survey runs
  on such a repository, as `readSurvey` called directly; `ork onboard` itself
  refuses a repository with no commit earlier). Secrets are masked by the
  pattern-based scrubber (ADR-091), so a secret that matches no pattern in a
  subject still goes to the model provider. It is the first thing cut at the
  survey's 6,000-character bound (L407).
- **L434 · `finish` in a subfolder project: a file outside the project is
  refused, even one the tool leaves.** `changesOf` now strips the project's
  folder (`git rev-parse --show-prefix`) from each path, so a project that is a
  subfolder of its repository is checked from its own folder, and a path outside
  it reads `../…` and is refused. The writer's worktree is the whole
  repository's, so a file a driver leaves outside the project folder, such as
  command-code's empty `.commandcode/taste/taste.md` at the repository's top, is
  refused (`../.commandcode/taste/taste.md`), not ignored: the taste exception
  holds only inside the project folder. Not checked: which folder a command-code
  writer runs in for such a project.
