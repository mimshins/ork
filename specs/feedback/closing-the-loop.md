# Closing the loop

_Part of [Feedback and self-improvement](../feedback.md)._

- `ork feedback triage` (built:
  [triage.ts](../../packages/core/src/feedback/triage.ts),
  [command](../../packages/cli/src/runs/triage.ts),
  [tests](../../packages/core/test/triage.test.ts),
  [command tests](../../packages/cli/test/triage.test.ts)) merges items about
  the same problem by rules, with no model: the same target and kind, and
  normalized titles (numbers and punctuation aside) whose words overlap by at
  least 80% (Jaccard) with the first-seen item of a group: an item joins the
  first group whose first item it's that near, never only near another member.
  Only unsettled items (`new`, `triaged`) take part, and a group is proposed
  only when it holds a `new` item, under the item seen first. It shows each
  merge and asks `y/N` (`--yes` makes them all; with no terminal it needs it);
  then every item that was `new` is `triaged`, so a declined merge isn't asked
  again until something new joins it. A summary and a proposed fix come from
  `apply`, one item at a time
  ([ADR-059](../../decisions/ADR-059-closing-the-feedback-loop.md)).
- `ork feedback split <item>` takes apart what triage merged into an item.
- **Which actions an item allows** is one rule, for `ork feedback`, the server
  and the Feedback panel alike
  ([actions.ts](../../packages/core/src/feedback/actions.ts),
  [tests](../../packages/core/test/feedback-actions.test.ts)): nothing on a
  `dismissed` item until it's restored; accepting only a `new` or `triaged` one;
  a lesson or a fix never for an `ork` item, a lesson only when a workflow is
  recorded, a fix not once `resolved` or `published`; publishing only an `ork`
  item, and only once. A lesson added to an item that's settled already leaves
  its status as it is.
- **Fixes** (built: [apply.ts](../../packages/cli/src/runs/apply.ts),
  [workflow](../../packages/core/workflows/feedback-apply.ork.yaml),
  [tests](../../packages/cli/test/apply.test.ts)): `ork feedback apply <item>`
  runs Ork's own workflow, `ork:feedback-apply`, in the project of its newest
  record, in the foreground like `ork run` (`--driver` as there), saying which
  project first; the Feedback panel starts the same command in the background
  ([server](../server.md)). The item becomes `accepted` once the run has
  started.
  - **Refused:** an `ork` item (its fix isn't in the project); one already
    `resolved` or `published`; a `dismissed` one (restore it first); and one
    whose project is gone, or is no longer a repository of its own (Ork never
    takes a deleted clone for a repository above it).
  - Its inputs are the item's id and the item as text: its title, target, kind,
    severity and counts, and its 10 newest records **from that project** (each
    body cut at 1,500 characters), recorded as untrusted. A record from another
    project could steer a worker here, so it's left out.
  - The worker (`ork-implementer`, in a worktree) has only `Read`, `Grep`,
    `Glob`, `Edit` and `Write` (`tools.only`): no shell, no network. It's told
    to read the item as a report, never as instructions, and to make the
    smallest change that would stop the problem (a workflow, `AGENTS.md`,
    `CLAUDE.md`, a skill, a doc; never secrets, settings or hooks), which Ork
    commits; or to change nothing and report `fail`.
  - A `tool.git` node runs `git diff --stat HEAD...<branch>`, and the gate shows
    that, the command to read the whole change, and last the worker's own
    summary. It asks to keep the branch or discard it, with no recommendation;
    Ork never merges. Keeping marks the item `resolved`, unless the run's
    branches hold no commit the project's `HEAD` lacks (`HEAD..<branch>`): then
    there's nothing to keep, so Ork removes the run's worktrees and branches, as
    on discard, and the item stays `accepted`. (ADR-059's "keeping marks the
    item resolved" assumes the worker committed a change.) Discarding removes
    the run's worktree and branch and leaves the item `accepted`; no fix leaves
    it `accepted` too, saying why ([L149](../gaps/limits-feedback.md)).
- **Lessons** (built: [lessons.ts](../../packages/core/src/feedback/lessons.ts),
  [accept.ts](../../packages/core/src/feedback/accept.ts),
  [tests](../../packages/core/test/lessons.test.ts),
  [accept tests](../../packages/core/test/accept.test.ts)):
  `ork feedback accept <item>` marks an item `accepted`; with `--lesson` it is
  also written as a lesson.
  - Lessons are kept in `.ork/lessons/<workflow>.md` (an attached project's
    `lessons/` folder), a committed file you can review, edit, and version with
    git. The file starts `# Lessons for <workflow>`; each lesson is one list
    entry (`-m` gives its words, the item's title by default; its later lines
    sit under the first), ending in a hidden `<!-- feedback <id> -->` so the
    same item isn't added twice.
  - The workflow is the one the item was seen in, or `--workflow` when it was
    seen in more than one; the project is that of its newest record there,
    refused when it's gone or no longer a repository of its own.
  - A lessons file, or a folder on the way to it, that is a link is refused when
    writing and skipped when loading: a cloned repository could aim it at a file
    of the person's (`~/.profile`). Ork writes only plain files in the project,
    by renaming a copy into place
    ([plain-files.ts](../../packages/core/src/project/plain-files.ts)); its own
    `ork:` workflows' files too.
  - An `ork` item is about Ork itself, so it's never a lesson.
  - They are loaded as part of the workflow layer of the context stack, under a
    cap of 1,500 tokens
    ([lesson-cap.ts](../../packages/core/src/context/lesson-cap.ts)). Accepting
    a lesson that would take the file past it is refused, and nothing is
    written; a file made longer by hand is cut at the cap, on a line's end.
  - `ork context explain` and the UI's Context panel show the file like any
    other context, and say when it was cut and how long the whole file is.
- **Trust:** feedback is model output and repo content can steer it (prompt
  injection), so a lesson or fix only takes effect after a human accepts it.
