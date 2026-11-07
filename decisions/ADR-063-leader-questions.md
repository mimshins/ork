# ADR-063 — A child's question can go to its leader first

- **Status:** Accepted
- **Date:** 2026-11-08
- **Topic:** messaging / decisions / runtime
- **RFC:** waived — the maintainer decided the behavior directly, and chose the
  fork among the options below; the setting's place and the pass-on option were
  settled while building it

## Context

A session's `ask_user` went straight to the person. A leader with an approved
spec could often answer its children's questions itself, and a run would wait
less. Owner questions already existed for a loop out of rounds: Ork pushes the
question into the owner's live session through the bus, and it replies with
`answer`. That can't work for a child's question. A leader's delegated children
run while the leader waits inside its `delegate` or `spawn_worker` call
(ADR-017), and a message pushed into its session is read only after that call
returns, which waits on the child, which waits on the answer.

## Decision

A leader may take its children's questions first
([leader questions](../specs/messaging/leader-questions.md)):

- **The setting** is `questions: owner | user` on a `claude.leader`, for the
  questions of the `claude.leader` and `claude.worker` nodes it owns. `user`
  stays the default, so no workflow changes. A leader that sets it and owns no
  such node is the error `questions.no-children`. It sits on the leader, the
  narrowest place, because what is trusted is that leader's judgment about its
  own children; a workflow or project default would hand questions to leaders
  whose briefs settle nothing.
- **A fork of the leader's latest session answers.** The runtime port gains
  `SessionSpec.fork`, with `resume`: a new session from a copy, leaving the
  original as it was (`claude --resume <id> --fork-session`; the SDK's
  `forkSession: true`). The fork gets the child's question, options and context,
  can only read (`Read`, `Grep` and `Glob` as its only built-in tools, and no
  MCP server but Ork's, through the port's new `tools.strictMcp`), has at most 3
  turns, 5 minutes and what is left of the run's budget, and must report
  `choice` (an option, or the pass-on option `ask-user`, renamed when a child's
  option has that id) and `note`.
- **It never blocks the child.** A leader with no session yet, a run with
  nothing left to spend, and a fork that fails, runs out of turns, budget or
  time, or reports no valid choice all send the question to the person, as
  before. A child stopped meanwhile asks no one, and its question to the person
  is withdrawn.
- **Every answer is a decision that says who gave it.** `AnsweredBy` gains
  `owner`; decision records (store migration 17) and the `decision.opened` and
  `decision.answered` events carry the leader as `owner`. An owner's answer's
  note is the same `note` a person's answer has (ADR-062). A question passed on
  keeps the leader as `owner`, with its note in the context. `answer` takes an
  optional `note` too, recorded in `owner.answered`.
- **Its cost is the run's**, recorded against the leader, in the run summary and
  on resume: the fork's events are the leader's `node.event`s, every one marked
  `fork: true`, so the usage ledger and `ork logs` show it as the fork's, and a
  resume or `ork chat` never takes the fork's session for the leader's.
- Gates and permission prompts stay with the person. The child's clock runs
  while the fork works, and stands still once the person is asked.

## Options considered

- **Ask the leader only when it can take a turn** (its child runs in the flow),
  else the person. Safe and cheap, but delegated children, the main case, would
  never reach the leader.
- **A fork of the leader's session (chosen).** Works whether the leader waits or
  not, keeps its context, and leaves its own session untouched. Costs a new
  field on the runtime port and, per question, a read of the leader's whole
  session with no cache hit: the fork's tools and system prompt differ from the
  leader's, so its prefix can't match the leader's cache.
- **Let `delegate` return early with pending questions,** the leader answering
  and then calling a new tool to keep waiting. Changes ADR-017's contract and
  every leader's prompt.

## Consequences

- A leader's answers cost turns that a person's don't, each a cache miss over
  the leader's session; the run's budget bounds them, and the setting is off
  unless a workflow turns it on. Whether a fork reports its cost from zero or
  from the leader's total so far is unmeasured (G25).
- A fork sees the leader's session as it was last saved. While the leader waits
  in `delegate`, that ends with the pending call; no real session has been
  forked that way yet (G25).
- The fork of a leader whose session ran on a driver no longer ready here fails,
  and the person is asked.
