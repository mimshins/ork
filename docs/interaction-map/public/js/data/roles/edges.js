/**
 * @file The node roles map's connections: how the engine starts nodes, the flow
 *   edges between the roles (drawn as in-process routing by the scheduler), a
 *   leader's delegation, and where finished work goes. Lanes in use: `x` 278
 *   from the compiler down to the unreachable node; `x` 298, `y` 350 and `x`
 *   1090 from delegation to the leader; `x` 1360 between the tree's columns
 *   from the leader to the spawned worker; `y` 334 for the back edge from the
 *   join to the loop target; `y` 92 above every card from the leaf to the run
 *   summary.
 */

import { ENGINE, ROLES, WORKTREES } from "../refs.js";

/** @typedef {import("../types.js").MapEdge} MapEdge */

/** @type {ReadonlyArray<MapEdge>} */
export const EDGES = [
  // ── The engine starts nodes ─────────────────────────────────
  {
    id: "compiler-scheduler",
    from: "compiler",
    to: "scheduler",
    kind: "local",
    label: "the run graph, with `entries`",
    detail:
      "Only a workflow without errors compiles; warnings such as `graph.unreachable` still run.",
    docs: [ROLES.rules],
  },
  {
    id: "scheduler-entry",
    from: "scheduler",
    to: "entry",
    kind: "local",
    label: "activates at the start",
    detail: "Every entry activates when the run starts, with the run's inputs.",
    docs: [ROLES.activations],
  },
  {
    id: "scheduler-lone",
    from: "scheduler",
    to: "lone",
    kind: "local",
    label: "activates at the start",
    detail: "A lone node is an entry, so it starts with the others.",
  },
  {
    id: "compiler-orphan",
    from: "compiler",
    to: "orphan",
    kind: "local",
    label: "`graph.unreachable`",
    detail:
      "No entry reaches it through edges or ownership; `ork validate` warns with its line.",
    via: [
      [278, 160],
      [278, 536],
    ],
    docs: [ROLES.diagnostics],
  },
  {
    id: "delegation-leader",
    from: "delegation",
    to: "leader",
    kind: "local",
    label: "`delegate` · `spawn_worker`",
    detail:
      "A leader's session is given the two blocking tools; the engine runs what it asks for and returns the reports.",
    via: [
      [298, 406],
      [298, 350],
      [1090, 350],
      [1090, 146],
    ],
    docs: [ENGINE.delegation],
  },

  // ── In the flow ─────────────────────────────────────────────
  {
    id: "entry-middle",
    from: "entry",
    to: "middle",
    kind: "local",
    label: "taken: it succeeded",
    detail:
      "An edge without `when:` is taken when its source succeeded, and carries the source's output as the target's input.",
    docs: [ROLES.edges],
  },
  {
    id: "middle-leaf",
    from: "middle",
    to: "leaf",
    kind: "local",
    label: "taken",
    detail: "The leaf runs; nothing follows it on this branch.",
  },
  {
    id: "router-join",
    from: "router",
    to: "join",
    kind: "local",
    label: "taken: its `when:` holds",
    detail:
      "Under `mode: first`, a router takes only its first edge that holds.",
    docs: [ROLES.control],
  },
  {
    id: "router-skipped",
    from: "router",
    to: "skipped",
    kind: "local",
    label: "not taken",
    detail:
      "Its other edges resolve as not taken; the node they lead to is on a dead path.",
  },
  {
    id: "skipped-join",
    from: "skipped",
    to: "join",
    kind: "local",
    label: "resolved, not taken",
    detail:
      "A skipped node's edges are not taken, so the join waiting on it stops waiting and fires with the inputs that ran.",
    docs: [ROLES.activations],
  },
  {
    id: "join-loop",
    from: "join",
    to: "loop",
    kind: "local",
    label: "back edge · `maxRounds`",
    detail:
      "A cycle's bounded edge: taken while its condition holds, until it has been taken `maxRounds` times in the run.",
    via: [
      [1000, 334],
      [430, 334],
    ],
    docs: [ROLES.loops],
  },
  {
    id: "loop-gate",
    from: "loop",
    to: "gate",
    kind: "local",
    label: "taken",
    detail:
      "The loop target ran again; the gate asks before anything reads it.",
  },
  {
    id: "gate-reader",
    from: "gate",
    to: "reader",
    kind: "local",
    label: "your choice",
    detail:
      "The gate's edges read `choice`; the reader looks back through the gate to find where to work.",
    docs: [ROLES.upstream],
  },
  {
    id: "leaf-summary",
    from: "leaf",
    to: "summary",
    kind: "event",
    label: "`run.finished`",
    detail:
      "When nothing runs and nothing waits, the run ends; a leaf that failed and took no edge fails it.",
    via: [
      [950, 92],
      [1770, 92],
    ],
    docs: [ENGINE.scheduler],
  },

  // ── In the tree ─────────────────────────────────────────────
  {
    id: "leader-withEdges",
    from: "leader",
    to: "withEdges",
    kind: "local",
    label: "`delegate` · report",
    detail:
      "Delegated, it reports only to the leader; an edge can start it too.",
    both: true,
    docs: [ROLES.delegation],
  },
  {
    id: "leader-child",
    from: "leader",
    to: "child",
    kind: "local",
    label: "`delegate` · report",
    detail:
      "The child runs in its own worktree on a branch from the leader's, and `delegate` returns its report.",
    both: true,
    docs: [ROLES.delegation],
  },
  {
    id: "leader-spawned",
    from: "leader",
    to: "spawned",
    kind: "local",
    label: "`spawn_worker` · report",
    detail:
      "A new instance of a child worker, up to `maxWorkers`, with its own worktree.",
    via: [
      [1360, 160],
      [1360, 406],
    ],
    both: true,
    docs: [ROLES.delegation],
  },
  {
    id: "withEdges-subagent",
    from: "withEdges",
    to: "subagent",
    kind: "local",
    label: "inside its session",
    detail:
      "A sub-agent would run in its owner's Claude session; Ork does not pass it there yet.",
    status: "partial",
    docs: [ROLES.subagent],
  },
  {
    id: "child-merged",
    from: "child",
    to: "merged",
    kind: "git",
    label: "merged `--no-ff`",
    detail:
      "A passing child is merged into its leader's worktree before `delegate` returns; a conflict keeps its worktree instead.",
    docs: [WORKTREES.workspace],
  },
  {
    id: "root-kept",
    from: "root",
    to: "kept",
    kind: "git",
    label: "its worktree stays",
    detail:
      "Nothing merges a root's work; its worktree and branch are the run's result.",
    docs: [ROLES.afterRun],
  },
];
