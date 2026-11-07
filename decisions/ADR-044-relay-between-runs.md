# ADR-044 — Nodes of different runs message each other over a relay in the store

- **Status:** Accepted
- **Date:** 2026-11-03
- **Topic:** engine / message bus / CLI / server
- **RFC:** [RFC-003](../rfcs/archived/RFC-003-relay-between-runs.md)
- **Amends:** [ADR-025](./ADR-025-message-bus.md) (its bus stays one per run,
  and gains a way out)

## Context

Work often spans repositories, and agents in them need to talk while they work.
Ork's bus stopped at the run, and a run has one project. `ork chat` already
showed how to reach another process: a row in the store, and a wake on the run's
socket.

## Decision

1. **A link between nodes of live runs is the permission.** `ork relay <a> <b>`
   makes one, both ways, until `ork relay end` or either run ends. Only the user
   does, from the CLI or the local server.
2. **A message is a row in the store and a wake on a socket.** No process is
   added, and the store stays the record. Each run's events hold its side.
3. **A peer's message is an agent's:** a notice, then `read_inbox`, labelled
   with its sender. It carries none of the user's authority, and a link gives no
   access to the other's checkout or control of its run.
4. **`wait_for_messages`** lets a session wait for a reply without ending,
   giving up its slot. It also ends when Ork has something to tell the session,
   so a session already waiting hears of a new link at once.
5. **Every leader and worker gets the message tools**, because a session's tools
   are set when it starts. `links: off` in the rules leaves them out for a node
   with no one to write to, and refuses links.
6. **A link has a message limit.** At it, the user is asked to extend it or end
   it.
7. **A finished run's session is not resumed on an agent's word.** The send is
   refused with the reason; the user can resume it with `ork chat`.

The command is `ork relay` because `ork link` already points tools' folders at
`.ork/` ([ADR-031](./ADR-031-ork-is-the-origin.md)).

## Options considered

See [RFC-003](../rfcs/archived/RFC-003-relay-between-runs.md): a relay between
runs (chosen), agents calling `ork chat` themselves, and a separate relay
process. One run across projects is weighed in
[RFC-004](../rfcs/archived/RFC-004-workflows-calling-workflows.md).

## Rationale

It matches how the work already happens: separate sessions, introduced when
needed. Keeping each run in its own repository leaves worktrees, rules, context,
merges and resume alone. Using the path `ork chat` proved means nothing new has
to stay running.

## Consequences

- Budgets, concurrency and claims stay per run
  ([L39](../specs/gaps/limits-running.md),
  [L40](../specs/gaps/limits-messaging.md)).
- A link does not survive a resume, names one exact node, and has a limit of 100
  that is a guess ([L48, L49, L51](../specs/gaps/limits-messaging.md)).
- Proven on real sessions in two repositories on the CLI driver. The RFC asked
  for both drivers, but the machine had no API key: the maintainer accepted
  shipping with the SDK driver tracked in chore C5
  ([gaps](../specs/gaps.md#chores)). Both drivers deliver through
  `Session.send`, but the SDK path has only met stand-ins.
