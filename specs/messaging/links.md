# Links between runs

_Part of [Messaging, decisions and logs](../messaging.md)._

Status: **Built, proven on real sessions on the CLI driver**; the SDK driver
only against stand-ins ([C5](../gaps.md#chores))
([ADR-044](../../decisions/ADR-044-relay-between-runs.md),
[links.ts](../../packages/core/src/remote/links.ts),
[relay.ts](../../packages/core/src/remote/relay.ts),
[tests](../../packages/core/test/relay.test.ts)). The tests run two runs on
separate store connections over real sockets, with stand-in sessions. On
2026-11-03 two real sessions in two repositories were linked while one was
blocked in `wait_for_messages`, asked and answered a question, and finished;
`ork stop` ended a session blocked in a wait within a second. A guide:
[Working across projects](../../docs/guides/working-across-projects.md).

- **A link is the permission.** `ork relay <run>/<node> <run>/<node>`, or the
  server's `POST /api/links`, joins two leaders or workers of different live
  runs, both ways, until `ork relay end` or either run ends. Only the user makes
  them. It is a row in the store, so a sender's run checks it without asking the
  other.
- **Addressing.** `send_message(to: "<run>/<node>", body)`. A name without a
  slash means this run, so a workflow that uses no links is unchanged.
- **Delivery.** The sender's process checks the link, records `message.sent`,
  writes a `relay` command for the other run, and wakes its socket. That run
  takes the row, puts the message in the node's inbox (`message.received`), and
  sends the usual notice. With no socket, its one-second poll finds the row.
  Each run's events hold its side of the conversation, and `ork resume` rebuilds
  the inbox from them.
- **Told.** Making or ending a link writes a `notice` command to each side,
  pushed into its live session (`link.notice`). A session that starts later
  finds linked nodes in its system prompt.
- **Trust.** A peer's message is an agent's: a notice, then `read_inbox`,
  labelled with its sender. It never says the user wrote it, grants no
  permission, and is masked like every event. A link gives no access to the
  other's checkout, and no way to start, stop or decide for the other run.
- **Waiting.** `wait_for_messages` blocks until a message arrives, Ork has
  something to tell the session (so it hears of a new link at once), the time
  passes (default 300 seconds, at most 3600) or the session ends, and returns
  what came. The session gives up its slot meanwhile. It serves channels inside
  a run too.
- **The limit.** A link has `maxMessages` (default 100, both ways together). At
  the limit a send is refused and the sender's run asks the user, once, to
  `extend` it by the same number or `end` it.
- **Ending.** When a run ends, its links end and each peer's live session is
  told. A send to a finished run is refused, with the reason, and ends the link:
  a finished session is not resumed on an agent's word. A message to a node that
  has ended, in a run still live, waits in its inbox, and the sender is told it
  may not be read.
- **The `links` rule.** Every leader and worker gets the message tools, since a
  session's tools are set when it starts: about 1,500 characters of tool
  definitions (measured; about 365 tokens at four characters each). That is an
  upper bound: on the real runs Claude Code deferred them, and the session
  fetched them with its `ToolSearch` when it needed them. `links: off` in a
  project's or workflow's rules leaves them out for a node with no one to write
  to, and refuses links to the run.
