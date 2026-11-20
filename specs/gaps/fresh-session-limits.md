# Limits found building a fresh session for a builder's next task

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building [fresh sessions](../scheduler/fresh-sessions.md)
([ADR-103](../../decisions/ADR-103-fresh-session-for-the-next-task.md)), which
starts a delegated worker's next task in a new session once the old one's
context is over `sessions.freshOver`. What was left simpler, or could not be
checked:

- **L455 · The rule never fires on `codex`.** Codex reports usage once, at a
  turn's end, and what that sum holds was never checked, so the driver sets no
  `contextTokens` and a `codex` worker always resumes
  ([Codex](../runtime/codex.md#output-usage-and-ends)). Measuring what
  `turn.completed` holds across a turn with several requests would give it a
  figure.
- **L456 · No handover note after `ork resume`.** A resumed run keeps no earlier
  tasks, so a delegated builder starts fresh there, as before, with no note. The
  note is built from what the scheduler kept in the process.
- **L457 · No per-node override.** The threshold is a project rule that a
  workflow's `rules:` overrides, so one role cannot differ from another inside a
  workflow. A `session` field beside the node's, in `defaults` too, would close
  it.
- **L458 · The owner cannot keep the session for a follow-up.** A fix to the
  builder's own last task arrives through `delegate` like a new task, so a
  builder over the threshold starts fresh for it, with the note's last summary
  and the checkout. A field on a `delegate` task that keeps the session would
  close it, at the price of a model deciding.
- **L459 · `ork chat` cannot reach the old session.** `ork chat <run> <node>`
  talks to the node's latest own session, which after a fresh start is the new
  one.
- **L460 · The browser view does not show the fresh start.** Only `ork logs` and
  `--json` carry it (`fresh` on `node.started`); the log panel ignores the
  field.
- **L515 · The browser view does not show a fresh start from a changed driver.**
  `ork logs` and the live stream print
  `starts a fresh session: driver changed from <from> to <to>`, and `--json`
  carries `driverChanged` on `node.started`, but the log panel ignores the
  field, so a browser user sees a new session id and nothing says why
  ([a changed driver](../scheduler/fresh-sessions.md#a-changed-driver)).
- **L461 · The quality effect is unmeasured.** The estimate that found the
  saving (about 7% of builder cost) could not see what a fresh builder loses of
  its earlier tasks. The same-task A/B of both settings is pending, so the rule
  stays off by default until it is read.
- **L462 · A sub-agent's requests may make the figure read low.** `claude-code`
  skips messages with a `parent_tool_use_id`, but whether `open-code`'s
  `step_finish` and `command-code`'s `model_request_end` include a sub-agent's
  own requests was not verified; if they do, the last one can be a small prompt
  and the rule fires late.
