# A child's question to its leader first

_Part of [Messaging, decisions and logs](../messaging.md)._

Status: **Built**, against stand-in sessions and the stand-in `claude` only: no
real session has forked a leader yet ([G25](../gaps.md#gaps))
([owner-asks.ts](../../packages/nodes/src/owner-asks.ts),
[owners.ts](../../packages/core/src/run/owners.ts),
[tests](../../packages/cli/test/owner-questions.test.ts),
[unit tests](../../packages/nodes/test/owner-asks.test.ts)). Why:
[ADR-063](../../decisions/ADR-063-leader-questions.md).

## The setting

`questions: owner | user` on an `agent.leader`, for the questions of the
`agent.leader` and `agent.worker` nodes it owns, spawned instances included.
`user`, the default, sends them to the person as before. A leader that sets it
and owns no such node is the error `questions.no-children`.

## How a question goes

When a child calls `ask_user` and its leader has `questions: owner`:

1. **A fork of the leader's latest session answers it.** Ork resumes a copy of
   that session (`SessionSpec.fork`: `--resume <id> --fork-session` on the
   claude-code driver; [runtime](../runtime.md#the-port)), in the leader's
   checkout, with the leader's model and settings. Its prompt is the child's
   question, context, options and recommended one, and its report must be
   `choice`, one of the options or the pass-on option, and `note`, why. It can
   only read: its built-in tools are `Read`, `Grep` and `Glob` and nothing else
   (`tools.only`, so no `Bash`, write tool or `Agent`), it has no MCP server but
   Ork's (`strictMcp`), and of Ork's tools no `ask_user` and none of a leader's;
   the project's denials still hold, no subagents or plugins are passed, and a
   permission prompt is refused. It reports through the structured output
   `--json-schema` sets up. It has at most 3 turns (`FORK_MAX_TURNS`) and 5
   minutes (`FORK_TIMEOUT_MS`), after which it is interrupted and the person is
   asked. The leader's own session is left as it was, so this works while the
   leader waits in `delegate`.
2. **The pass-on option** is `ask-user`, or `ask-user-2`, `-3`, … when a child's
   option already has that id.
3. **An answer** goes back to the child: `ask_user` returns "Your owner, lead,
   chose: b" (the leader's id in backticks) and the note on the next line. It is
   a decision answered by `owner`, with the leader as its `owner` and the
   leader's words as its `note`.
4. **Passed on**, the question goes to the person as a decision whose `owner` is
   the leader, its context ending `lead passed this on: <note>`.
5. **The person is asked as before** when the leader has no session yet, the run
   has nothing left to spend, or the fork fails, runs out of turns, budget or
   time, or reports no valid choice. The child never waits on a fork for good.
6. **A stopped child asks no one.** If the asking node is stopped while its fork
   works, the fork is interrupted and `ask_user` fails, with no question put to
   the person; stopped while the person is asked, the question is withdrawn
   (`decision.withdrawn`), as the question carries the node's stop signal.
7. **A pause holds a fork back from starting**, not one already going: a fork
   waits at `start` on the asking node's hold, so a paused run, or a paused
   asking node, starts none until it continues. One that started before the
   pause runs to its end, bounded by its 3 turns and 5 minutes, as pausing never
   cuts a turn short. Pausing only the leader doesn't hold its forks.

Gates and permission prompts always go to the person.

## Spend, events and the clock

- The fork's spend is the run's and counts against its budget, its own capped by
  what is left; with nothing left, no fork starts. It is the leader's in the run
  summary, so the nodes' costs add up to `run.finished`'s `costUsd`.
- A resumed run keeps it: a fork is never resumed, so `ork resume` counts each
  fork's `session.finished` (by `<leader>/<fork session>`) when it reads the
  run's events, whether or not the leader finished, and adds it to the leader's
  summary.
- Its events are the leader's (`node.event` with `id` the leader), and every one
  of them carries `fork: true` on the runtime event, as none is the leader's own
  session or its words. `ork logs` and a run's transcript mark each line
  `lead │ fork · …` (`lead │ fork · opus, session …, to answer a question` for
  its start); the Logs panel prefixes `fork:`; the leader's thread in the Chats
  panel shows one line, "A fork took a child's question", and none of its words.
  The usage ledger counts its cost against the leader. A resume, `ork chat` and
  the feedback signals never take a fork's session for the leader's.
- **No shared prompt cache.** The fork's tools, MCP servers and system prompt
  differ from the leader's, so its prefix can't match the leader's cache: each
  question pays to read the leader's session again at the 5-minute write rate.
  It asks for no 1-hour cache (`promptCache` is dropped), which would cost more
  to write and never be read ([G25](../gaps.md#gaps)).
- The child's clock runs while the fork works, as the leader is working; it
  stands still once the person is asked ([timeouts](../scheduler.md#timeouts)).

## Who answered

`decision.opened` and `decision.answered` carry `owner`, and the store's
decision records keep it (migration 17). `ork decide --list` shows
`work via lead`, the run's transcript `→ b (lead)`, and the Decisions panel
"passed on by lead" on an open card and "Answered … by `lead`, its owner" in the
settled list.
