# Capturing feedback

_Part of [Feedback and self-improvement](../feedback.md)._

**Three sources:**

| Source             | How it is captured                                                                                                                                                                                                | Why                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **System signals** | Derived from the event store, with no model call: a loop hit `maxRounds`, an escalation, a budget overrun, a permission denial, a tool error, a decision that timed out, the user overriding a recommended option | Free and objective                                |
| **Agent reports**  | The `feedback` tool every agent node gets                                                                                                                                                                         | Agents see friction that no event shows           |
| **Human notes**    | Rating or annotating a node's result in `ork decide`, `ork feedback`, or the UI                                                                                                                                   | The best signal for whether a result was _useful_ |

**System signals** (built), each recorded right after the event that shows it: a
loop out of rounds (`loop.exhausted`), a budget that ran out
(`budget.exhausted`), a tool the user denied (`permission.denied`), an Ork tool
that returned an error (`tool.error`, which leaves out the `report` tool), a
report the `report` tool refused (`report.rejected`, a context gap the agent's
own: the agent got its report wrong, not Ork), a gate that timed out and took
its default (`gate.timeout`), and an answer other than the recommended one
(`recommendation.overridden`). They are derived where a run's events are
recorded, so the decision queue's events count too.

A failed node's end files by who should act on it (the per-node `end.<kind>`
signal, [end-signals.ts](../../packages/core/src/feedback/end-signals.ts)): an
`ork` kind (`unknown`, `driver_crashed`) is a bug carrying the scrubbed detail,
a `workflow` kind a workflow note, an `agent` kind a context gap. An account's,
provider's or user's end is a setup hint on screen, not feedback, and an agent's
`fail` report or a tool node's non-zero exit is its answer, not filed
([how a session ends](../runtime/session-ends.md)). It can duplicate the run's
own record of the same cause (`budget.exhausted`, `report.rejected`): the two
have different fingerprints, so both are kept
([L247](../gaps/end-kinds-limits.md)).

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
- Records carry a `feedbackVersion` so the format can evolve. An imported line
  with a higher one was made by a newer Ork, and is left out with that reason
  and `ork upgrade` as the fix. There are no migrations yet: the first arrives
  with the first version 2.

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
  or a unique prefix of it; an item merged into another is found as that one, so
  `split` with either takes the whole group apart.
- **Noting while you decide:** `ork decide --id <d> --choose <o>` takes
  `--note <text>` and `--rating good|bad`, and after a good answer notes the
  decision's node the same way (a rating alone is noted as "Rated good at
  <question>"). The note is checked before the answer, which can't be taken
  back. It is feedback about the node, kept apart from `--say`, the answer's own
  note that goes to the run ([decisions](../messaging.md#decisions)). The
  server's `POST /api/runs/:id/notes` takes the same note for the UI's Note
  dialog in the Monitor ([server](../server/api.md),
  [panels](../ui/panels-runs-and-monitor.md#monitor)); all three check it with
  [`recordNote`](../../packages/core/src/feedback/human.ts).
