# Next release

_Part of [What's new](../whats-new.md)._

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
