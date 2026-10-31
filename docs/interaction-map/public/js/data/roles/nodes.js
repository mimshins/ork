/**
 * @file The node roles map's components: the engine pieces that decide when a
 *   node runs, the places a node can take in the flow (entry, leaf, lone,
 *   skipped, unreachable, …), the places it can take in the ownership tree
 *   (root, leader, owned child, spawned worker, sub-agent), and what a run
 *   leaves behind. Each card is a role, not one node; its facts say how to
 *   write a node into it. Coordinates are in map units; the map is {@link SIZE}
 *   wide and tall.
 */

import {
  CORE,
  ENGINE,
  NODE_TYPES,
  ROLES,
  RUNTIME,
  STORE,
  WORKTREES,
} from "../refs.js";

/** @typedef {import("../types.js").MapNode} MapNode */
/** @typedef {import("../types.js").Zone} Zone */
/** @typedef {import("../types.js").Group} Group */

/** The map's extent, in map units. */
export const SIZE = { w: 1920, h: 640 };

/**
 * The columns, left to right.
 *
 * @type {ReadonlyArray<Zone>}
 */
export const ZONES = [
  { id: "engine", label: "Ork engine", x: 20, w: 260, tone: "orange" },
  { id: "flow", label: "In the flow · edges", x: 300, w: 780, tone: "teal" },
  {
    id: "tree",
    label: "In the tree · parent",
    x: 1100,
    w: 520,
    tone: "amber",
  },
  { id: "after", label: "What a run leaves", x: 1640, w: 260, tone: "slate" },
];

/**
 * Outlined boxes that group components running together.
 *
 * @type {ReadonlyArray<Group>}
 */
export const GROUPS = [
  {
    id: "owned",
    label: "owned by the leader",
    x: 1110,
    y: 222,
    w: 500,
    h: 370,
  },
];

/** @type {ReadonlyArray<MapNode>} */
export const NODES = [
  // ── Ork engine ──────────────────────────────────────────────
  {
    id: "compiler",
    title: "Graph compiler",
    sub: "`entries` · tree · cycles",
    zone: "engine",
    x: 40,
    y: 110,
    status: "built",
    pkg: "core",
    src: "packages/core/src/graph",
    summary:
      "Reads the workflow's `edges:` and every node's `parent:` and works out each node's place: which nodes start the run, who owns whom, which cycles are bounded, and which nodes nothing reaches. `ork validate` prints what it finds.",
    facts: [
      "An entry has no incoming edge and no owner; a workflow needs at least one (`graph.no-entry`).",
      "Ownership: a sub-agent is owned by a leader or a worker, every other owned node by a leader; the tree has no cycles.",
      "Every cycle needs an edge with `maxRounds` (`graph.unbounded-cycle`).",
      "A node no entry reaches through edges or ownership is a `graph.unreachable` warning.",
    ],
    see: [
      { map: "architecture", node: "compiler", label: "The compiler's part" },
    ],
    docs: [CORE.compile, CORE.flow, CORE.tree, ROLES.rules],
  },
  {
    id: "scheduler",
    title: "Scheduler",
    sub: "activations · dead paths",
    zone: "engine",
    x: 40,
    y: 240,
    status: "built",
    pkg: "core",
    src: "packages/core/src/run/scheduler.ts",
    summary:
      "Runs the compiled graph. A node runs once per activation: the entries when the run starts, every other node when an incoming edge is taken. The run ends when nothing runs and nothing waits.",
    facts: [
      "A taken edge hands its source's output to its target as input.",
      "A node runs whenever any incoming edge is taken; only a join waits.",
      "Dead paths: a node whose every way in resolved as not taken is skipped, and so is what only it leads to.",
      "A node that failed and took no edge fails the run; other branches still finish.",
    ],
    see: [
      { map: "lifecycle", node: "scheduler", label: "The scheduler in a run" },
    ],
    docs: [ENGINE.scheduler, ENGINE.routing, ENGINE.tests, ROLES.activations],
  },
  {
    id: "delegation",
    title: "Delegation",
    sub: "`delegate` · `spawn_worker`",
    zone: "engine",
    x: 40,
    y: 370,
    status: "built",
    pkg: "core",
    src: "packages/core/src/run/delegation.ts",
    summary:
      "The other way a node runs: its leader asks for it. A leader's session gets two blocking tools that run owned children in parallel and return when each has reported.",
    facts: [
      "`delegate([{ child, brief }])` runs declared children; `spawn_worker([{ template, brief }])` runs new instances of a child worker.",
      "A task is refused, with the reason in its report, when the child is not the leader's or is already running.",
      "While a leader waits, its session slot goes to its children, so it never deadlocks at `concurrency: 1`.",
    ],
    docs: [
      ENGINE.delegation,
      ENGINE.delegationTests,
      RUNTIME.delegate,
      ROLES.delegation,
    ],
  },

  // ── In the flow ─────────────────────────────────────────────
  {
    id: "entry",
    title: "Entry",
    sub: "no incoming edge, no owner",
    zone: "flow",
    x: 320,
    y: 110,
    status: "built",
    pkg: "core",
    summary:
      "A root of the flow: it starts when the run starts. Several entries start together, as far as the run's concurrency allows.",
    facts: [
      "Any node type can be an entry; `ork validate` prints the entries (`starts at …`).",
      "An entry reads `{{inputs.*}}`; there is no upstream output yet.",
      "An owned node is never an entry: with no incoming edge it waits for its leader.",
    ],
    docs: [CORE.flow, ROLES.compileTests, ROLES.rules],
  },
  {
    id: "middle",
    title: "Middle node",
    sub: "runs on any taken edge",
    zone: "flow",
    x: 580,
    y: 110,
    status: "built",
    pkg: "core",
    summary:
      "A node with edges in and out. It runs each time one of its incoming edges is taken, with that edge's source output as its input, then decides its own outgoing edges.",
    facts: [
      "With two edges in, it can run twice in one round; put a `control.join` in front to wait for both.",
      "An edge without `when:` is taken when its source succeeded: a report not `fail`, exit code 0, an answered gate.",
      "`when: status == 'fail'` lets a branch handle a failure instead of failing the run.",
    ],
    docs: [ENGINE.routing, ENGINE.tests, ROLES.edges],
  },
  {
    id: "leaf",
    title: "Leaf",
    sub: "no outgoing edge",
    zone: "flow",
    x: 840,
    y: 110,
    status: "built",
    pkg: "core",
    summary:
      "Where a branch ends. Its output is the branch's result, read in the run summary and by nothing downstream.",
    facts: [
      "A leaf that fails fails the run: it has no edge to take a failure to.",
      "A failing node whose edges were all not taken counts the same; leaves are where it usually happens.",
      "A Claude leaf with no owner is also an ownership root, so its worktree is kept for you.",
    ],
    docs: [ENGINE.scheduler, ENGINE.tests, ROLES.edges],
  },
  {
    id: "lone",
    title: "Lone node",
    sub: "no edges, no owner",
    zone: "flow",
    x: 320,
    y: 240,
    status: "built",
    pkg: "core",
    summary:
      "A node with no edge and no `parent` is not an orphan: it is an entry and a leaf at once. It runs when the run starts, beside the other entries, and its branch ends with it.",
    facts: [
      "A workflow of one node is a lone node.",
      "It gets no upstream input; only `{{inputs.*}}` and `{{run.*}}`.",
      "Its failure fails the run, like any leaf's.",
    ],
    docs: [CORE.flow, ROLES.compileTests, ROLES.rules],
  },
  {
    id: "router",
    title: "Router or split",
    sub: "picks its edges",
    zone: "flow",
    x: 580,
    y: 240,
    status: "built",
    pkg: "core",
    summary:
      "A control node that passes its input through and fans out. A split decides every outgoing edge as usual; a router takes only its first edge whose `when:` holds (`mode: first`), or all of them.",
    facts: [
      "The edges a router does not take resolve as not taken, which starts a dead path.",
      "A router whose edges have no `when:` is a `router.conditions` warning.",
      "Control nodes work nowhere: a readonly node looks back through them.",
    ],
    docs: [ENGINE.routing, ENGINE.tests, ROLES.control],
  },
  {
    id: "join",
    title: "Join",
    sub: "`all` · `any` · `n`",
    zone: "flow",
    x: 840,
    y: 240,
    status: "built",
    pkg: "core",
    summary:
      "The one node that waits. `all` fires once every input resolved, `any` on the first input that ran, `n` once `n` ran; it is skipped when not enough of them ran.",
    facts: [
      "It outputs `statuses`, `results` and `count` for conditions such as `any(statuses, 'changes_requested')`.",
      "A skipped input resolves the join's wait without running, so a join never hangs on a dead branch.",
      "A join with fewer than two inputs is a `join.inputs` warning.",
    ],
    see: [{ map: "lifecycle", node: "reviews", label: "A join in a run" }],
    docs: [ENGINE.routing, ENGINE.tests, ROLES.control],
  },
  {
    id: "loop",
    title: "Loop target",
    sub: "re-entered, up to `maxRounds`",
    zone: "flow",
    x: 320,
    y: 370,
    status: "built",
    pkg: "core",
    summary:
      "A node a back edge returns to. It runs again with the new input, as long as the back edge has been taken fewer than `maxRounds` times; then the run asks whether to stop, allow one more round, or carry on.",
    facts: [
      "A re-entered worker starts fresh with a `## Round n` section; a leader resumes its session. `session:` chooses either way.",
      "A worker in a worktree keeps it across rounds.",
      "Its owner, while working, is asked when the loop runs out; otherwise you are.",
    ],
    see: [{ map: "lifecycle", journey: "review-loop", label: "A review loop" }],
    docs: [ENGINE.scheduler, ENGINE.tests, ROLES.loops],
  },
  {
    id: "gate",
    title: "Gate",
    sub: "your choice picks the edge",
    zone: "flow",
    x: 580,
    y: 370,
    status: "built",
    pkg: "nodes",
    summary:
      "A `human.gate` anywhere in the flow: it asks you a question and outputs your `choice`, which its outgoing edges read in `when:`. With a `timeout` and a `default`, an unattended run carries on.",
    facts: [
      "It works nowhere: a readonly node after it looks back through it to the node before.",
      "It outputs `choice` and `answeredBy` (`user` or `timeout`).",
      "Answered from the run's terminal or `ork decide`.",
    ],
    see: [{ map: "messaging", label: "How a question reaches you" }],
    docs: [NODE_TYPES.gate, NODE_TYPES.tests, ROLES.upstream],
  },
  {
    id: "skipped",
    title: "Skipped node",
    sub: "every way in not taken",
    zone: "flow",
    x: 840,
    y: 370,
    status: "built",
    pkg: "core",
    summary:
      "A node on a dead path: every incoming edge that is not a loop edge resolved as not taken. It does not run, records `node.skipped`, and its own outgoing edges are not taken either.",
    facts: [
      "A branch can be skipped in one round and run in the next.",
      "Loop edges do not count, so a loop target is not skipped while its loop may still return.",
      "A skipped node does not fail the run.",
    ],
    docs: [ENGINE.routing, ENGINE.tests, ROLES.activations],
  },
  {
    id: "orphan",
    title: "Unreachable node",
    sub: "`graph.unreachable`",
    zone: "flow",
    x: 320,
    y: 500,
    status: "built",
    pkg: "core",
    summary:
      "The real orphan: a node that has a way in, but no entry reaches it through edges or ownership. `ork validate` warns, and in a run it never starts.",
    facts: [
      "Typical causes: its edges come only from other unreachable nodes, or it sits in an ownership cycle.",
      "It is a warning, not an error: the rest of the workflow still runs.",
      "Unlike a skipped node, it records nothing; the run ends without it.",
    ],
    docs: [CORE.flow, ROLES.compileTests, ROLES.diagnostics],
  },
  {
    id: "reader",
    title: "Readonly reader",
    sub: "works where its input did",
    zone: "flow",
    x: 580,
    y: 500,
    status: "built",
    pkg: "core",
    summary:
      "A `readonly` node with no owner, such as a reviewer or approver, works in the worktree its input came from, so it reads the change it is reviewing. Its incoming edges are followed back through control nodes and gates to the nodes that ran.",
    facts: [
      "When those nodes all worked in one worktree, it works there; otherwise in the project root.",
      "With an owner, it works in its nearest owner's worktree instead.",
      "Its write tools are denied.",
    ],
    docs: [ROLES.upstream, ROLES.worktreeTests, ROLES.where],
  },

  // ── In the tree ─────────────────────────────────────────────
  {
    id: "leader",
    title: "Leader",
    sub: "owns and delegates",
    zone: "tree",
    x: 1120,
    y: 110,
    status: "built",
    pkg: "core",
    summary:
      "A `claude.leader` is the only node that owns others (besides a worker owning sub-agents). It plans, delegates to its children, gets their reports, and has their work merged into its worktree.",
    facts: [
      "Before its children start, Ork commits its work, so they branch from it.",
      "A re-entered leader resumes its session, keeping its context.",
      "`maxWorkers` caps how many workers it may spawn (default 0).",
    ],
    see: [{ map: "lifecycle", node: "builder", label: "A leader in a run" }],
    docs: [ENGINE.delegation, ENGINE.delegationTests, ROLES.delegation],
  },
  {
    id: "root",
    title: "Ownership root",
    sub: "no `parent`",
    zone: "tree",
    x: 1380,
    y: 110,
    status: "built",
    pkg: "core",
    summary:
      "A node with no owner: the top of its own tree. Every entry is one. A root that works in a worktree branches from `git.base`, and its worktree is the run's result.",
    facts: [
      "Its worktree stays after the run, listed in the run summary with its branch.",
      "Nothing merges it: under `commit: auto` its work is on its branch; under `never` it stays uncommitted.",
      "Its children, if any, are merged into it.",
    ],
    docs: [WORKTREES.manager, WORKTREES.tests, ROLES.afterRun],
  },
  {
    id: "withEdges",
    title: "Child with edges",
    sub: "delegated, or by an edge",
    zone: "tree",
    x: 1120,
    y: 240,
    status: "built",
    pkg: "core",
    summary:
      "An owned node can also have incoming edges. It runs when its leader delegates to it, and when one of those edges is taken.",
    facts: [
      "A delegated run reports only to its leader and follows none of its edges.",
      "A run started by an edge follows its edges like any flow node.",
      "Delegating to it while it already runs is refused, with the reason in the report.",
    ],
    docs: [ENGINE.delegation, ENGINE.delegationTests, ROLES.delegation],
  },
  {
    id: "child",
    title: "Owned child",
    sub: "runs when delegated",
    zone: "tree",
    x: 1380,
    y: 240,
    status: "built",
    pkg: "core",
    summary:
      "A node with a `parent` and no incoming edge. It is not an entry: it runs only when its leader delegates to it, in its own worktree branched from the leader's branch, and reports back.",
    facts: [
      "Its session gets its own `prompt`, then `## Task from` the leader and the brief.",
      "A passing child is merged into the leader's worktree before `delegate` returns.",
      "A failed child is a report with `ok: false`, for the leader to handle.",
    ],
    see: [{ map: "lifecycle", node: "security", label: "A child in a run" }],
    docs: [ENGINE.delegation, ENGINE.delegationTests, ROLES.delegation],
  },
  {
    id: "subagent",
    title: "Sub-agent",
    sub: "in its owner's session",
    zone: "tree",
    x: 1120,
    y: 370,
    status: "partial",
    pkg: "core",
    summary:
      "A `claude.subagent` lives inside its owner's session, a leader's or a worker's, as a Claude Code subagent: no process, no worktree, no edges of its own.",
    facts: [
      "Accepted and validated: it needs a Claude `parent`, and an edge to it is an error (`edge.subagent`).",
      "Not built: Ork does not pass it to its owner's session yet.",
    ],
    docs: [CORE.tree, ROLES.compileTests, ROLES.subagent],
  },
  {
    id: "spawned",
    title: "Spawned worker",
    sub: "`<template>-n`",
    zone: "tree",
    x: 1380,
    y: 370,
    status: "built",
    pkg: "core",
    summary:
      "A new instance of one of the leader's child workers, made at run time with `spawn_worker`. It works like its template, in its own worktree on its own branch, owned by the leader.",
    facts: [
      "Named `<template>-2`, `-3`, …, up to the leader's `maxWorkers`.",
      "Not in the workflow file; the run summary lists it by its instance id.",
      "Merged into the leader's worktree like a declared child.",
    ],
    docs: [ENGINE.delegation, ENGINE.delegationTests, ROLES.delegation],
  },
  {
    id: "idle",
    title: "Idle child",
    sub: "never delegated, never runs",
    zone: "tree",
    x: 1380,
    y: 500,
    status: "built",
    pkg: "core",
    summary:
      "An owned child its leader never delegates to. It is reachable, so `ork validate` does not warn; whether it runs is the leader's call, made in its session.",
    facts: [
      "It records nothing and gets no worktree.",
      "Give it an incoming edge if it must run whatever the leader decides.",
    ],
    docs: [ENGINE.delegation, ROLES.compileTests, ROLES.delegation],
  },

  // ── What a run leaves ───────────────────────────────────────
  {
    id: "summary",
    title: "Run summary",
    sub: "`run.finished` · reasons",
    zone: "after",
    x: 1660,
    y: 110,
    status: "built",
    pkg: "core",
    summary:
      "What the run says when it ends: its status (`succeeded`, `failed`, `budget_exhausted`, `interrupted`), each node that ran or was skipped, why it did not succeed, and the worktrees it left.",
    facts: [
      "A run fails when a node failed and took no edge; its reason names the node.",
      "Recorded in the event store; `ork ps`, `ork logs` and `ork tree` read it.",
    ],
    see: [
      { map: "architecture", node: "eventStore", label: "The event store" },
    ],
    docs: [ENGINE.scheduler, STORE.store, ROLES.activations],
  },
  {
    id: "kept",
    title: "Kept worktrees",
    sub: "the roots' results",
    zone: "after",
    x: 1660,
    y: 240,
    status: "built",
    pkg: "core",
    summary:
      "The worktrees a run leaves for you: each ownership root's, and any child's whose merge failed. Each is beside the clone, on its branch (or detached under `commit: never`).",
    facts: [
      "`ork worktrees` lists them; `ork worktrees clean` removes them, asking first.",
      "Ork never pushes, and never deletes a branch its runs did not create.",
    ],
    see: [{ map: "architecture", node: "worktrees", label: "Git worktrees" }],
    docs: [WORKTREES.manager, WORKTREES.list, ROLES.afterRun],
  },
  {
    id: "merged",
    title: "Merged child",
    sub: "worktree removed, branch kept",
    zone: "after",
    x: 1660,
    y: 370,
    status: "built",
    pkg: "core",
    summary:
      "A child whose work reached its leader: merged `--no-ff` into the leader's worktree, or applied as a patch under `merge: patch`. After the run its worktree is removed; its branch stays.",
    facts: [
      "A conflict aborts the merge; the child's output gets `merge: { ok: false, … }` and its worktree is kept.",
      "A child whose owner has no worktree is not merged.",
    ],
    docs: [WORKTREES.workspace, WORKTREES.tests, ROLES.afterRun],
  },
];
