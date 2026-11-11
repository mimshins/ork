# Limits found building for each

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building `forEach` ([RFC-013](../../rfcs/archived/RFC-013-for-each.md),
[running a node once per item](../scheduler/for-each.md), 2026-11-08). The
engine, CLI, Monitor, Builder, guides and example are built; what follows is
what was left simpler. The one real run on each driver is [C12](../gaps.md).

- **L198 · A `messages` channel can't name a fanned node.** It is the compile
  error `forEach.channel`: a link joins one node, and items don't exist until
  the list is resolved. Beside [L49](../messaging/limits.md). A fanned node's
  items can't be written to by name.
- **L200 · A fanned node is never resting.** The run's timeout clock counts
  while the items of a node whose `watch:` they are sleeping, as time a run
  spends working.
- **L201 · Stopping a fanned node waits on slots.** `ork stop --node build`
  waits for a session slot to free before items waiting for one give up, and
  while the question about a list over `maxItems` is open it answers that the
  node is not running.
- **L202 · A fanned `workflow.call` with `wait: none` says nothing.** With no
  `notify:` body, the message sent when it finishes is `<id>: ` with empty text.
- **L203 · A failed item stays closed on a resume.** `resumeState` closes a node
  or item that failed or never finished for good, so one that fails, then passes
  on a resume, runs again on a second resume.
- **L204 · A `stop` answer replays.** The answer `stop` to the question about a
  list over `maxItems` is given again on resume, so the run stops there again,
  as a loop's stop does.
- **L205 · A walk says little about gathered lists.** It makes no claim about
  `statuses` of a list longer than two, nor about `items` or `results`.
- **L206 · Item fields and sources are checked loosely.** `{{item.<field>}}` on
  a static list is checked against the keys every entry has; `from` reading a
  workflow input is `forEach.not-list`, since there are no list inputs; a
  `workflow.call` or split as the source gives only `forEach.undeclared`.
- **L207 · The tree and the transcript show little progress.** A fanned node's
  line reads `✓ 3 ran`, with no "n of m" while it runs, and item ids can be
  wider than the transcript's id column.
- **L209 · A Claude node's declared list isn't checked in the file.**
  `claude.worker`'s `output.schema` stays `record<string, unknown>`, so a `list`
  there is checked by the run, not by the file's schema.
- **L210 · A cut-off Claude item is tested at core level only.** The kill and
  resume of an item mid-session is covered on stand-ins; no CLI-level test
  restarts a real process.
- **L211 · An item can finish before its owner has a worktree.** When an owner
  and its fanned child start together, an item that finishes before the owner's
  worktree exists is not merged, and the node still succeeds. `ork validate`
  refuses only an owner that can't start until the child has finished.
- **L212 · A `from:` list resumes masked.** Events are stored with secrets
  masked, so a list read from an earlier node comes back on a resume with
  `[masked]` in place of a secret, as any handed-back output does. A static
  `items:` list uses the file's values.
- **L214 · The Builder declares a list's item fields as plain types only.** Its
  Add a list takes `name` or `name:type` (string, number, integer, boolean).
  Item fields with a value list or a nested list are written in a text editor;
  the Builder shows and keeps them.
- **L215 · A later, shorter list leaves stale item rows.** When a fanned node in
  a loop lists fewer items in a later round, the items past the new end read
  `waiting` for that round, then `skipped` when the run ends, and keep the
  earlier round's cost and output. The progress count is right; only those rows
  mislead.
- **L231 · A fanned reviewer has no way back to finish reading.** A self-loop
  reruns every item, so `build`'s three reviewers dropped the
  `coverage: partial` round. What a reviewer didn't read is in its `unchecked`,
  at the `ratify` and `decide` gates, and doesn't hold the run back.
- **L262 · An item's own model is checked by shape, and only `model` and
  `effort` come from it.** Ork keeps no list of model names, so a written or
  `from:` item's `model` is checked only to be one word with no space, brace or
  quote; a name Claude Code doesn't know fails that item when its session
  starts. `item` is the only thing a `model` or `effort` template reads (not
  `index`, `inputs` or `nodes`), and `driver`, `budgetUsd`, `maxTurns` and the
  other fields can't come from an item. Some session plans have no item to
  render with, so a template there falls back to the defaults: `ork chat` on an
  item resumes it on the model its session started on (the event records it),
  but at the default effort, which no event records; `ork run --node` on a
  fanned node, and an owner's fork that answers a question from an item, plan
  without the item and take the default model and effort.
  ([an item's own model and effort](../scheduler/for-each.md#an-items-own-model-and-effort))
