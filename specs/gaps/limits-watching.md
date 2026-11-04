# Limits: watching a source

_Part of [Known gaps and limits](../gaps.md)._

What `watch:` and `ork watch` do for now, by choice
([ADR-053](../../decisions/ADR-053-watching-a-source.md)).

- **L116 · The floors on `every` aren't measured.** 5 seconds for `watch:` and 1
  minute for a trigger are guesses, to set on first real use.
- **L117 · A trigger reads a list, not a stream.** An event that falls off the
  end of the list between looks is missed, as is one while the machine sleeps,
  if it's gone by the time it wakes. The other way round, an old item can slide
  onto a list cut short by a limit, and starts a run as if it were new, so the
  guide's example filters by date.
- **L118 · The Monitor's count and next look are estimates.** The store records
  changes, not looks, so they're worked out from `every`, and a slow look or a
  pause puts them out. They say "about".
- **L119 · Accepting covers the trigger, its workflow's text, its check's own
  files and the project's folder, no further.** A change to a skill, an agent in
  another file, a script the workflow calls, a workflow it calls, an MCP server
  the workflow's nodes use or `project.yaml` doesn't turn the trigger off, nor
  does a file a check's `script:` runs, as Ork can't tell what a program reads.
  A check's `.mcp.json` is hashed whole, so a change to another server turns it
  off too.
- **L120 · `trigger.untrusted` reads prompts and instructions only.** A value a
  session reaches another way, through a tool's output or a `before:` step,
  isn't warned of. Only `tools: { only }` limited to `Read`, `Grep` and `Glob`
  counts as narrowed, not a `tools: { allow }`.
- **L121 · Untrusted inputs are marked, not fenced.** The run records which they
  are, but a prompt reads them as it does any other.
- **L122 · `triggers.yaml` has no builder and no JSON Schema.** It's written by
  hand and checked by `ork validate`, and the UI only shows how triggers stand.
- **L123 · An in-repo project needs `ork init` before it's watched.**
  `ork watch` covers registered projects, and a fresh clone with `.ork/` isn't
  one until then.
- **L124 · Seen keys are kept for good.** Nothing prunes `trigger_seen`, as a
  row is small and forgetting one could start its run again.
- **L125 · A caller's clock counts a called run's wait.** A `workflow.call`
  isn't resting while the run it called waits between looks, so the caller's
  `limits.timeout` and the call's `timeout` go on running.
- **L126 · A check's report is capped at 64 KiB.** That's the most a tool's JSON
  result can be, so a longer report fails the look. Keep the list short.
- **L127 · What's new is counted from the last look, however long ago.** After
  `ork watch` was stopped for a week, or a trigger changed and changed back with
  no new acceptance, whatever is new on the list starts, up to the daily cap.
- **L128 · A key that won't start is given up on after 3 looks.** The count is
  kept in memory, so restarting `ork watch` starts it again, and a key that
  failed for a passing reason, such as a machine too slow to start it, isn't
  tried again.
- **L129 · The launchd and systemd files in the guide haven't been run.** The
  plist is checked for form, but neither has kept `ork watch` alive across a
  real restart.
