# Limits found building for each

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building `forEach` ([RFC-013](../../rfcs/active/RFC-013-for-each.md),
[running a node once per item](../scheduler/for-each.md), 2026-11-08). The
engine and CLI are built; what follows is what was left simpler, or is waiting
for the second run (the Monitor and the Builder).

- **L197 · The Monitor, the Builder and the Logs panel don't show fanned
  nodes.** A node with `forEach` draws as one card with no progress, the node
  table lists its items as plain nodes, the Builder has no `forEach` group or
  `from` dropdown, and the Logs panel's node filter matches exact ids, so
  `build` leaves out `build.2` (`ork logs --node` and the events route group
  them). Removed by the second run.
- **L198 · A `messages` channel can't name a fanned node.** It is the compile
  error `forEach.channel`: a link joins one node, and items don't exist until
  the list is resolved. Beside [L49](../messaging/limits.md). A fanned node's
  items can't be written to by name.
- **L199 · The guides and the example are pending.** The writing-workflows and
  leaders guides, the `ORK_ITEM` and `ORK_INDEX` rows of the scripts guide's
  environment table, the Claude Code plugin's `write` skill and an example with
  a fanned node wait for the second run, so `forEach` is usable but unguided.
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
- **L208 · The Builder's condition model reads a list as text.** A list field is
  `kind: text` in `says.ts` until the second run teaches the Builder lists.
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
