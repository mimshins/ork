# Limits: walking a workflow

_Part of [Known gaps and limits](../gaps.md)._

What walking a workflow does for now, by choice
([walking](../scheduler/walking.md),
[RFC-009](../../rfcs/archived/RFC-009-walking-a-workflow.md)).

- **L139 · A walk's warnings can be wrong.** `walk.never-runs` and
  `walk.only-rounds` say only what the walk tried, and it doesn't try every
  outcome a run can have: the order parallel branches finish in, a loop edge
  crossed exactly once (later rounds repeat the second), a failed commit that
  keeps the node's `status`, or a failed tool's other fields, such as git's
  `head`. Rules hold the warnings back where they'd most often be wrong, and
  each review so far has found shapes they missed; the walk's tests hold each
  one found.
- **L140 · The fuzz is evidence, not proof.** It runs random workflows on the
  real scheduler with a walk's own outcomes, so it can't see a stand-in that
  differs from a real node. It makes no watched, owned or MCP nodes and no
  `len(statuses)`, and its finish orders pass turns without waiting on timers,
  so it misses races that need one. Its search stops at 1,500 paths a workflow
  without saying so.
- **L141 · A very wide workflow overruns a walk's time.** Past a couple of
  thousand nodes in parallel a walk runs past its limit, by about what compiling
  the workflow costs: 2,000 take about 360 ms against the builder's 200 ms.
  Compiling is the larger cost: about 10 seconds for a chain of 2,000 nodes, and
  6,000 routers in a row overflow the stack
  ([flow.ts](../../packages/core/src/graph/flow.ts)).
- **L142 · Purity is checked for files, processes and sockets.** The walk's
  purity test patches `fs`, `child_process` and `net`'s connections, not
  `new net.Socket()`, `http`, or every `fs` call, such as `utimes`.
