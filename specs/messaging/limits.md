# Limits: messaging, claims and links

_Part of [Messaging, decisions and logs](../messaging.md)._

How [messaging](../messaging.md), claims and [links between runs](./links.md)
work for now, by choice. Those the gaps review carried are open work in the
[register](../gaps.md#limits).

- **L10 · Claims are advisory.** They steer agents but lock nothing: a node that
  edits without claiming is not stopped.
  ([ADR-027](../../decisions/ADR-027-advisory-claims.md))
- **L38 · A long home path has no sockets.** A Unix socket's path is limited
  (103 bytes on macOS, 107 on Linux). Past that a run cannot listen: it looks at
  the store every second instead, so answers and commands take up to a second,
  and followers poll the store too. `ork doctor` warns when the home path is too
  long for a run's socket. ([messaging](../messaging.md#reaching-a-live-run))
- **L40 · Claims are per run.** Two runs in one repository work in separate
  worktrees but do not see each other's claims.
  ([messaging](../messaging.md#claims))
- **L48 · A link does not survive a resume.** A link ends with its run, so a
  resumed run has none until the user links it again. Its unread messages are
  kept. ([messaging](./links.md))
- **L49 · A link names one node.** It joins the exact node given, so a spawned
  worker needs its own (`tests-2`), and a run of one node (`ork run --node`)
  cannot be linked. ([messaging](./links.md))
- **L50 · The UI can only look at links.** The Monitor lists a run's links and
  opens the run at the other end. Making and ending one is still `ork relay`.
  ([messaging](./links.md))
- **L51 · A link's limit of 100 is a guess.** Nothing has measured how many
  messages real work takes. ([messaging](./links.md))
- **L52 · A link ending can cost a session a turn.** Each peer is told, and a
  session that is writing its report then takes one more turn to acknowledge it.
  Seen on a real run. Telling only a session that is waiting would avoid it.
  ([messaging](./links.md))
- **L183 · A leader's claims can deadlock its children.** A leader that claims
  paths and then waits in `delegate` keeps them, so children doing that work are
  refused the same paths and nothing moves until the run is stopped. Seen on a
  real run; `tools.deny: [mcp__ork__claim]` on the leader avoids it. A leader's
  claims could pass to its children while it waits.
