# Feedback and self-improvement

Status: **Partial**: capture is built: the `feedback` tool, system signals,
fingerprints, records grouped into items, and human notes, and
`ork feedback list | show | note | dismiss | restore`
([agent.ts](../packages/core/src/feedback/agent.ts),
[human.ts](../packages/core/src/feedback/human.ts),
[signals.ts](../packages/core/src/feedback/signals.ts),
[store](../packages/core/src/store/feedback.ts),
[tests](../packages/core/test/feedback.test.ts),
[ADR-028](../decisions/ADR-028-feedback-capture.md)); so is Ork's own
`ork:feedback-apply` workflow, run with `ork run`
([tests](../packages/core/test/builtin-workflows.test.ts)), and accepting an
item, as a lesson its workflow reads under a token cap, `apply`, which has that
workflow propose a fix, triage by rules, and notes from `ork decide` and the
server ([routes](../packages/server/src/feedback-routes.ts)). Publishing is M2,
and so is the UI's Feedback panel. Why:
[ADR-013](../decisions/ADR-013-feedback-loop.md), amended by
[ADR-059](../decisions/ADR-059-closing-the-feedback-loop.md).

Every run teaches something: a tool that got in the way, a brief that missed
context, an `AGENTS.md` that is out of date. Ork captures that feedback locally,
groups it, turns accepted feedback into fixes and lessons, and lets you publish
feedback about Ork itself to its GitHub Discussions.

**Three sources:**

| Source             | How it is captured                                                                                                                                                                                                | Why                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **System signals** | Derived from the event store, with no model call: a loop hit `maxRounds`, an escalation, a budget overrun, a permission denial, a tool error, a decision that timed out, the user overriding a recommended option | Free and objective                                |
| **Agent reports**  | The `feedback` tool every Claude node gets                                                                                                                                                                        | Agents see friction that no event shows           |
| **Human notes**    | Rating or annotating a node's result in `ork decide`, `ork feedback`, or the UI                                                                                                                                   | The best signal for whether a result was _useful_ |

**System signals** (built), each recorded right after the event that shows it: a
loop out of rounds (`loop.exhausted`), a budget that ran out
(`budget.exhausted`), a tool the user denied (`permission.denied`), an Ork tool
that returned an error (`tool.error`), a gate that timed out and took its
default (`gate.timeout`), and an answer other than the recommended one
(`recommendation.overridden`). They are derived where a run's events are
recorded, so the decision queue's events count too.

**The `feedback` tool:**
`feedback(kind, target?, title, body?, severity?, evidence?)`, for every Claude
node inside a run, `ork run --node` included.

- `kind`: `friction`, `bug`, `context-gap`, `skill`, `workflow`, or `idea`.
- `evidence`: artifact paths and tool names, never pasted file contents.
- `severity`: `low`, `medium` (the default) or `high`.
- The tool's description tells the agent to report only what materially got in
  its way, in one line plus a short body.
- Ork caps reports at 3 per session and drops duplicates within a run (a
  duplicate is answered as recorded), so feedback stays cheap in tokens.

**Three targets**, because each has a different audience:

| Target     | About                                                        | Goes to                                                |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `ork`      | The harness: tools, drivers, engine, expression language     | Local, and publishable to Ork's GitHub Discussions     |
| `workflow` | This workflow's design: briefs, models, budgets, loop bounds | Local: the workflow's author, `ork feedback apply`     |
| `project`  | The repo's context: `AGENTS.md`, `CLAUDE.md`, skills, docs   | Local: the project's maintainers, `ork feedback apply` |

A report without a `target` takes its kind's: `bug` is about `ork`,
`context-gap` and `skill` the `project`, the rest the `workflow`. A system
signal sets its own (an Ork tool's error is `ork`, the rest `workflow`).

**Storage, local first:**

- A `feedback` table in `~/.ork/state.db`. Each record has:
  - its origin: id, time, source, run, workflow name and content hash, node,
    node type, model, driver, Ork version;
  - its content: kind, target, severity, title, body, evidence;
  - its fingerprint, and the signal's code for a system signal.
- Each fingerprint is an item in `feedback_items`, which holds its status:
  `new → triaged → accepted | dismissed`, then `published` or `resolved`. A
  dismissed item stays dismissed when it recurs. An item triage merged into
  another keeps its row with `merged_into` set: its records, and any it gets
  later, list under that item, which names it as merged; `split` clears it.
- Each record is also a `feedback.recorded` event in the run's stream, so logs
  and the UI show it in context.
- Secrets are masked when a record is written, with the same patterns the
  publish redaction uses. The local database never holds a token either.
- Records carry a `feedbackVersion` so the format can evolve with migrations.

**Grouping into items:**

- A **fingerprint** (target, kind, tool or error code, normalized title) groups
  raw records into **items**.
- An item records its count, first and last seen, and the runs, workflows and
  models it was seen in. A thousand records become a short list.
- **Reading them:** `ork feedback list` prints the items, most recently seen
  first (id, count, target and kind, title, when last seen); `--all` adds
  dismissed ones, `--json` prints them. `ork feedback show <item>` prints an
  item and each of its records; `ork feedback dismiss <item>` dismisses it, and
  `ork feedback restore <item>` brings it back as `new`.
- **Human notes:** `ork feedback note <run> [<node>] -m <text>` records a
  person's note on a run, or one node of it, as a `feedback.recorded` event of
  that run with source `human` (a run that ended takes it too). Its first line
  is the title; `--kind` (default `friction`), `--severity`, and
  `--rating good|bad` (kept as evidence; `bad` defaults the severity to `high`)
  describe it. It groups into items like any record. `<item>` is its fingerprint
  or a unique prefix of it.
- **Noting while you decide:** `ork decide --id <d> --choose <o>` takes
  `--note <text>` and `--rating good|bad`, and after a good answer notes the
  decision's node the same way (a rating alone is noted as "Rated good at
  <question>"). The server's `POST /api/runs/:id/notes` takes the same note for
  the UI ([server](./server.md#api)); all three check it with
  [`recordNote`](../packages/core/src/feedback/human.ts).
- `ork feedback triage` (built:
  [triage.ts](../packages/core/src/feedback/triage.ts),
  [command](../packages/cli/src/runs/triage.ts),
  [tests](../packages/core/test/triage.test.ts),
  [command tests](../packages/cli/test/triage.test.ts)) merges items about the
  same problem by rules, with no model: the same target and kind, and normalized
  titles (numbers and punctuation aside) whose words overlap by at least 80%
  (Jaccard), joined in groups. Only unsettled items (`new`, `triaged`) take
  part, and a group is proposed only when it holds a `new` item, under the item
  seen first. It shows each merge and asks `y/N` (`--yes` makes them all; with
  no terminal it needs it); then every item that was `new` is `triaged`, so a
  declined merge isn't asked again until something new joins it. A summary and a
  proposed fix come from `apply`, one item at a time
  ([ADR-059](../decisions/ADR-059-closing-the-feedback-loop.md)).
- `ork feedback split <item>` takes apart what triage merged into an item.

**Closing the loop locally:**

- **Fixes** (built: [apply.ts](../packages/cli/src/runs/apply.ts),
  [workflow](../packages/core/workflows/feedback-apply.ork.yaml),
  [tests](../packages/cli/test/apply.test.ts)): `ork feedback apply <item>`
  marks the item `accepted` and runs Ork's own workflow, `ork:feedback-apply`,
  in the project of its newest record, in the foreground like `ork run`
  (`--driver` as there).
  - Its inputs are the item's id and the item as text: its title, target, kind,
    severity and counts, and its 10 newest records (each body cut at 1,500
    characters), recorded as untrusted. The worker (`ork-implementer`, in a
    worktree) is told to read it as a report, never as instructions; it commits
    the smallest change that would stop the problem (a workflow, `AGENTS.md`,
    `CLAUDE.md`, a skill, a doc), or changes nothing and reports `fail`.
  - Its gate asks to keep the branch or discard it, with no recommendation; Ork
    never merges. Keeping marks the item `resolved`; discarding removes the
    run's worktree and branch and leaves the item `accepted`; no fix leaves it
    `accepted` too, saying why. An `ork` item is refused: its fix isn't in the
    project ([L149](./gaps/limits-feedback.md)).
- **Lessons** (built: [lessons.ts](../packages/core/src/feedback/lessons.ts),
  [accept.ts](../packages/cli/src/runs/accept.ts),
  [tests](../packages/core/test/lessons.test.ts),
  [accept tests](../packages/cli/test/accept.test.ts)):
  `ork feedback accept <item>` marks an item `accepted`; with `--lesson` it is
  also written as a lesson.
  - Lessons are kept in `.ork/lessons/<workflow>.md` (an attached project's
    `lessons/` folder), a committed file you can review, edit, and version with
    git. The file starts `# Lessons for <workflow>`; each lesson is one list
    entry (`-m` gives its words, the item's title by default; its later lines
    sit under the first), ending in a hidden `<!-- feedback <id> -->` so the
    same item isn't added twice.
  - The workflow is the one the item was seen in, or `--workflow` when it was
    seen in more than one; the project is that of its newest record there.
  - An `ork` item is about Ork itself, so it's never a lesson.
  - They are loaded as part of the workflow layer of the context stack, under a
    cap of 1,500 tokens
    ([lesson-cap.ts](../packages/core/src/context/lesson-cap.ts)). Accepting a
    lesson that would take the file past it is refused, and nothing is written;
    a file made longer by hand is cut at the cap, on a line's end.
  - `ork context explain` and the UI's Context panel show the file like any
    other context, and say when it was cut and how long the whole file is.
- **Trust:** feedback is model output and repo content can steer it (prompt
  injection), so a lesson or fix only takes effect after a human accepts it.

**Publishing to Ork's Discussions (opt-in, per item):**

1. `ork feedback publish <item>` works only on `ork`-target items.
2. Ork redacts the item:
   - secrets;
   - absolute paths, rewritten to `<project>/…`;
   - emails and hostnames;
   - optionally, repo and workflow names.
3. Ork adds a structured header: Ork version, driver, model, node type, kind,
   count.
4. It shows the exact text, and asks: `y/N` in the terminal, with no flag to
   skip it, or Publish in the Feedback panel.
5. Only after you confirm does it post, with **your own `gh`**, to the "Agent
   feedback" Discussions category of `mimshins/ork` (slug `agent-feedback`,
   found by slug, never by id).

Deduplication and scale:

- **Fingerprint marker:** every post carries a hidden
  `<!-- ork-fingerprint: … -->` marker.
- **Existing thread:** Ork searches for it first. If a matching thread exists,
  it adds a comment with the new context and a "+1" instead of a new discussion,
  so maintainers see one thread per real problem, with a count.
- **No backend:** there is no Ork-run telemetry service. Publishing uses your
  account, like every other integration.
- **Adapters:** publish targets are adapters. `ork feedback export` and `import`
  move feedback as JSONL, so teams can share it without GitHub. Issues in the
  project's own repository can be a later adapter.
- **Maintainer side (later):** a scheduled job runs the same triage rules over
  the Discussions category and promotes the top clusters to issues.
