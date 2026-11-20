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
that returned an error (`tool.error`, which leaves out the `report` tool and
refused arguments), a report the `report` tool refused (`report.rejected`, a
context gap the agent's own: the agent got its report wrong, not Ork), arguments
an Ork tool's schema refused (`tool.arguments`, also the agent's: the decoder
sees the tool's answer start with "Invalid arguments, nothing ran:" and sets the
`tool.result`'s `fault`, on every driver: Command Code's decoder reads it from a
`tool_errored` frame's `error`), a gate that timed out and took its default
(`gate.timeout`), an answer other than the recommended one
(`recommendation.overridden`), a tool a driver's own guard keeps refusing
(`tool.refused`, below), and a shell rule people keep allowing
(`permission.suggest`, below). They are derived where a run's events are
recorded, so the decision queue's events count too.

**A tool the guard keeps refusing is the agent's context gap** (`tool.refused`,
[ADR-112](../../decisions/ADR-112-shipped-reads-without-pnpm.md)):

- The decoders of Codex, Command Code, omp and OpenCode set `fault: "refused"`
  on the `tool.result` of a call the driver's guard refused: Codex on the hook's
  own refused result, the others by recognising the guard's refusal text
  ([refusal.ts](../../packages/runtime/src/tools/refusal.ts)). A pause, a stop
  and a gate that could not be asked are not marked. `claude-code` has no marker
  (its refusal is the `permission` tool's), so it never files this signal.
- The observer counts marked results by node and tool (the name from the call's
  `tool.called`; a refused result with no call before it is not counted). The
  third refusal of one tool by one node files one record
  ([refused-signal.ts](../../packages/core/src/feedback/refused-signal.ts)); one
  or two file none.
- The record is a low `context-gap` for the `workflow`, titled
  `<tool> was refused repeatedly`; its body says to add a rule to the node's
  `tools.allow` or tell the node not to use the tool, and its evidence is the
  tool's name, never a command or its output. The node is not in the title, so
  two nodes refused the same tool give one item.
- A guard-refused Ork tool counts here, not as `tool.error`, and never changes a
  run's result. Limits: [L530, L532](../gaps/permissions-limits.md).

**A rule people keep allowing is proposed, not written** (`permission.suggest`,
[RFC-028](../../rfcs/archived/RFC-028-permissions-without-asking.md) part 4):

- On a permission decision answered `allow`, `allow-node` or `allow-run`, the
  observer reads the project's answered permission decisions, every run's
  (`DecisionStore.decisions({ project, status: "answered" })`, through
  `SignalOptions.permissions`). Without that option no rule is proposed.
- A decision's rules are the `ruleFor` rules of its context's commands that its
  options' descriptions named, so a prompt that offered no rule (an unreadable
  line, another tool, a yolo allow) counts for nothing.
- A rule is proposed once it was allowed at least 3 times across at least 2
  distinct runs (`suggest-thresholds.ts`), was never answered `allow-always` (it
  is in the file already, or was meant to be), and the project's allow rules do
  not cover it.
- The record is a low `friction` item for the `project`, titled by its rule, so
  it is fingerprinted per rule; its evidence is the rule line and the rules file
  (`permissions.allow` in `.ork/project.yaml`, or the attached project's
  `project.yaml`). A run records it once. Nothing is written to the file: the
  person adds it. `permission.denied` reads only a `deny` answer, so the allow
  ids never file one.

**An Ork tool's refusal or failure says why**
([ADR-106](../../decisions/ADR-106-tool-result-carries-the-ork-message.md)):

- The decoder sets the `tool.result`'s `message` beside `fault`, from the same
  text, only when it is Ork's own (it starts with "Invalid arguments, nothing
  ran:" or with the marker Ork's tools put on a failure). A Bash result or
  Claude Code's own validation text has no marker, so no `message`, on any
  driver.
- `tool.arguments` and `tool.error` records carry it as evidence after the tool
  name: its first line, at most 300 characters, passed through `maskSecrets` and
  then the run's env-value scrubber (`SignalOptions.scrub`).
- Both are titled by tool, `Ork's <tool> tool refused a call's arguments` and
  `Ork's <tool> tool returned an error`. The node is not in the title, so it is
  not in the fingerprint: two nodes refused by the same tool give one item. The
  record keeps its `node` and origin.
- A run keeps one record per tool; a later message for the same tool is dropped
  ([L484](../gaps/tool-message-limits.md)). Claude Code's own validation text
  has no marker and files as `tool.error` without a message
  ([L485](../gaps/tool-message-limits.md)). The marker is matched as a
  substring, so the `mcp__ork__` tool-name filter in `signals.ts` is what keeps
  other tools' text out ([L488](../gaps/tool-message-limits.md)); an error
  thrown inside an Ork tool has no message
  ([L489](../gaps/tool-message-limits.md)).

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
  `new → triaged → accepted | dismissed`, then `published` or `resolved`
  (`ork feedback apply` keeping a fix, or `ork feedback resolve` for one fixed
  by hand). A dismissed item stays dismissed when it recurs; a resolved one goes
  back to `new` on a record newer than its resolving (an older, imported record
  leaves it resolved). An item triage merged into another keeps its row with
  `merged_into` set: its records, and any it gets later, list under that item,
  which names it as merged; `split` clears it.
- Each record is also a `feedback.recorded` event in the run's stream, so logs
  and the UI show it in context.
- Secrets are masked when a record is written, with the same patterns the
  publish redaction uses, and then the run's env-value scrubber, so a configured
  `env:` secret's value in a record the run files is stored `[masked]`
  ([masking](../event-store.md#masking)). The local database never holds a token
  either. A note typed with `ork feedback note`, `ork decide --note` or in the
  browser is scrubbed with the env values the run's workflow file names now
  (`scrubberOfRun`; `ork ui` hands it to the server), and by pattern only when
  that file is gone or no longer parses.
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
  first (id, count, target and kind, title, when last seen); with no flag it
  hides the dismissed and resolved ones, and `--status` (`new`, `triaged`,
  `accepted`, `dismissed`, `published`, `resolved`, or `all`), `--kind`,
  `--severity`, `--workflow` and `--run` (an id or a unique start of one) filter
  it ([list filters](../cli/list-filters.md)); `--status all` adds them, `--ids`
  prints the item ids on one line, `--limit n` keeps the first N, and `--json`
  prints them. `ork feedback show <item>` prints an item and each of its
  records; `ork feedback dismiss <item>` dismisses it, and
  `ork feedback restore <item>` brings it back as `new`.
  `ork feedback resolve <item>…` (several ids, space or comma separated) marks
  items fixed outside `apply` resolved, and changes none when one is unknown,
  dismissed, or resolved or published already
  ([feedback-resolve.ts](../../packages/cli/src/commands/feedback-resolve.ts)).
  The fixing commit isn't stored: it is in the repository's history.
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
