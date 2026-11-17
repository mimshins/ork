# Next release

_Part of [What's new](../whats-new.md)._

- **Ork's own workflows and agents no longer steer reading away from
  `extract`.** `ork onboard`'s proposer was told to "Read the files", the
  security audit to "Read" whole skill documents and to use `cat`, `grep` or
  `sed` in Bash, and the built-in reviewer to "Read it with git"; one onboard
  proposal made 17 whole-file reads and no `extract` call. They now say what to
  look at and leave how to Ork's reading rule
  ([skills and context](../guides/skills-and-context.md#reading-part-of-a-file-extract)).
- **Keep works when your project never lets Ork commit.** With `commit: never`
  in `.ork/project.yaml`, `ork onboard` and `ork feedback apply` showed an empty
  branch at their keep question, and keep kept nothing. They now show the change
  from the worker's worktree, and keep copies it into your checkout as
  uncommitted files for you to commit; if it clashes with your own changes,
  nothing is copied and the worktree's path is printed
  ([the gate](../guides/onboarding/the-gate-and-its-checks.md#the-gate)).
- **`ork onboard` can edit a workflow that names its own agents.** Its check
  refused any agent but `ork-implementer` and `ork-reviewer`, and any `driver`
  or `model`, so editing an existing workflow made the writer strip them. A
  workflow you already had keeps the ones it names; only new ones are refused
  ([what is checked](../guides/onboarding/the-gate-and-its-checks.md#what-is-checked-and-what-is-only-asked-for)).
- **The audit checks npm and pnpm advisories on Windows.** The scanner started
  `npm` and `pnpm` directly, which Windows refuses for their `.cmd` shims, so
  the report only noted that advisories were not checked. It now starts them
  through a shell there
  ([the audit](../guides/security-audit.md#which-scanner-checks-dependencies)).
- **`ork onboard` lists the right files in a subfolder project.** When your
  project is a subfolder of its git repository, the note telling the writer
  which files are not in its worktree named paths from the repository's top
  (`sub/.ork/project.yaml`); it now lists them from the project folder
  (`.ork/project.yaml`), and no longer repeats the starter file `ork init` made
  ([what it does, in order](../guides/onboarding.md#what-it-does-in-order)).
- **`ork logs -f --all`, `ork decide --follow` and `ork attach` see a resumed
  called run.** Resuming a run whose called run had ended brought that run back
  under its id, but a follower already watching had stopped at its old end, so
  its events and questions showed only after you restarted the command. Now the
  called run is followed again when it comes back.
- **A reviewer after a tool step reads the right worktree.** A `readonly` node
  with no owner works where its input came from, but a tool node in between
  (`build -> stat -> review`, with `stat` running in the build's worktree
  through `cwd:`) counted as working in the project root, so the reviewer read
  an unchanged checkout. A tool node whose `cwd` is inside one of the run's
  worktrees now counts as working there, also when a run is resumed
  ([worktrees](../guides/worktrees.md#choosing-a-nodes-isolation)).
- **`ork validate ork:security-audit` passes in an attached project.** A project
  attached with `ork register` no longer gets six false
  `ref.context ... does not exist` errors; `ork context explain` lists the
  audit's context files there too
  ([the audit](../guides/security-audit.md#in-a-project-attached-with-ork-register)).
- **A stopped node reads "was stopped".** When `ork stop` aborts a run and a
  node's session throws while it is torn down, the node ends as interrupted, not
  as "ended for a reason Ork doesn't recognize"
  ([why a node stopped](../guides/why-a-node-stopped.md#interrupted)).
- **The audit lists an unpinned action once.** The same `uses:` value in several
  jobs of a workflow file is one finding, with the count in its title, not one
  per job.
- **The audit report no longer contradicts its own run status.** Its posture
  text names what was not reviewed or verified and never calls the run complete
  or incomplete; the Run section says it, from the run's status.
- **`ork onboard` names every uncommitted file the writer lacks.** Besides what
  `ork init` just made, the writer is told about uncommitted files under `.ork/`
  and `.gitignore` of your project, so it does not look for them
  ([onboarding](../guides/onboarding.md)).
- **Sessions see `extract` from their first turn.** Claude Code had deferred it
  behind its tool search with Ork's other tools, so sessions read with Read and
  the shell instead. Ork now asks Claude Code to load it up front, and its
  description says to cut a read to a match or a line range
  ([guide](../guides/skills-and-context.md#reading-part-of-a-file-extract)).
- **Ork tells every session how to read through `extract`.** Its note now covers
  `grep` and `git` output too, asks for several `extract` calls in one turn
  rather than one chained shell command, and keeps a whole-file Read for a file
  the session edits. The security audit no longer tells its agents to search
  with Grep, a tool Claude Code 2.1.326 gives a session only when its node lists
  it ([guide](../guides/skills-and-context.md#reading-part-of-a-file-extract)).
