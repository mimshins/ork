# Feedback and self-improvement

Status: **Specified**: capture in M1d; triage, apply, lessons and publishing in
M2. Why: [ADR-013](../decisions/ADR-013-feedback-loop.md).

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

**The `feedback` tool:**
`feedback(kind, target, title, body, severity, evidence[])`.

- `kind`: `friction`, `bug`, `context-gap`, `skill`, `workflow`, or `idea`.
- `evidence`: event ids and artifact paths, never pasted file contents.
- The tool's description tells the agent to report only what materially got in
  its way, in one line plus a short body.
- Ork caps reports per session (default 3) and drops duplicates within a run, so
  feedback stays cheap in tokens.

**Three targets**, because each has a different audience:

| Target     | About                                                        | Goes to                                                |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `ork`      | The harness: tools, drivers, engine, expression language     | Local, and publishable to Ork's GitHub Discussions     |
| `workflow` | This workflow's design: briefs, models, budgets, loop bounds | Local: the workflow's author, `ork feedback apply`     |
| `project`  | The repo's context: `AGENTS.md`, `CLAUDE.md`, skills, docs   | Local: the project's maintainers, `ork feedback apply` |

Ork pre-fills the `target` from the evidence (a tool error is `ork`; a missing
input in a brief is `workflow`), and the agent may override it.

**Storage, local first:**

- A `feedback` table in `~/.ork/state.db`. Each record has:
  - its origin: id, time, source, run, workflow name and content hash, node,
    node type, model, driver, Ork version;
  - its content: kind, target, severity, title, body, evidence;
  - its lifecycle: status and fingerprint.
- Status moves `new → triaged → accepted | dismissed`, then `published` or
  `resolved`.
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
- `ork feedback triage` runs the built-in `ork:feedback-triage` workflow over
  new items. It merges near-duplicates, writes a summary for each item, and
  proposes a fix. Ork improves itself with its own engine.

**Closing the loop locally:**

- **Fixes:** `ork feedback apply <item>` runs a node that proposes a fix as a
  diff: a workflow edit, or an `AGENTS.md`, `CLAUDE.md` or skill change on a
  branch.
  - The proposed fix is a Decision; nothing is applied without your answer.
- **Lessons:** you can accept an item as a **lesson**.
  - Lessons are kept in `.ork/lessons/<workflow>.md`, a committed file you can
    review, edit, and version with git.
  - They are loaded as part of the workflow layer of the context stack, under a
    token cap (default 1,500 tokens).
  - `ork context explain` shows them like any other context.
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
4. It shows the exact text as a Decision.
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
- **Maintainer side (later):** a scheduled job runs the same triage workflow
  over the Discussions category and promotes the top clusters to issues.
