/** @file The node roles map's journeys. */

import { ENGINE, ROLES } from "../refs.js";

/** @typedef {import("../types.js").Journey} Journey */

/** @type {ReadonlyArray<Journey>} */
export const JOURNEYS = [
  {
    id: "entry-to-leaf",
    title: "From the entries to the leaves",
    who: "Compiler · scheduler · an entry · a lone node · a leaf",
    summary:
      "How a run starts at its entries, moves along taken edges, and ends when its leaves are done.",
    steps: [
      {
        from: "compiler",
        title: "The compiler finds the entries",
        detail:
          "Every node with no incoming edge and no `parent`. With none, `graph.no-entry` stops the workflow from compiling.",
        docs: [ROLES.rules],
      },
      {
        from: "compiler",
        to: "scheduler",
        title: "The run graph goes to the scheduler",
        detail: "With each node's edges, children and the list of entries.",
      },
      {
        from: "scheduler",
        to: "entry",
        title: "Every entry activates",
        detail:
          "Together, as far as the run's concurrency allows, each with the run's inputs.",
        docs: [ROLES.activations],
      },
      {
        from: "scheduler",
        to: "lone",
        title: "A lone node starts too",
        detail:
          "No edges and no owner make it an entry and a leaf at once: it runs now and ends its own branch.",
      },
      {
        from: "entry",
        to: "middle",
        title: "A taken edge carries the output",
        detail:
          "The entry succeeded, so its edge without `when:` is taken and its output becomes the middle node's input.",
        docs: [ROLES.edges],
      },
      {
        from: "middle",
        title: "It runs on any taken edge",
        detail:
          "Each taken incoming edge activates it again; only a join waits for several.",
      },
      {
        from: "middle",
        to: "leaf",
        title: "The leaf ends the branch",
        detail: "It has no edge out; its output is the branch's result.",
      },
      {
        from: "leaf",
        to: "summary",
        title: "The run ends",
        detail:
          "When nothing runs and nothing waits. A leaf that failed and took no edge fails the run, and the summary names it.",
        docs: [ENGINE.scheduler],
      },
    ],
  },
  {
    id: "dead-path",
    title: "A dead path, a loop and a gate",
    who: "Router · skipped node · join · loop target · gate · reader",
    summary:
      "How an edge not taken skips a branch without stalling the join after it, and how a bounded loop and a gate route work back.",
    steps: [
      {
        from: "router",
        to: "join",
        title: "The router takes one edge",
        detail: "Its first edge whose `when:` holds, under `mode: first`.",
        docs: [ROLES.control],
      },
      {
        from: "router",
        to: "skipped",
        title: "Its other edge is not taken",
        detail: "It resolves as not taken.",
      },
      {
        from: "skipped",
        title: "The node is skipped",
        detail:
          "Every way in resolved as not taken, so it does not run; the run records `node.skipped`.",
        docs: [ROLES.activations],
      },
      {
        from: "skipped",
        to: "join",
        title: "The join stops waiting",
        detail:
          "The skipped node's edge resolves as not taken, so `all` has every input and fires with the `statuses` of those that ran.",
      },
      {
        from: "join",
        to: "loop",
        title: "A back edge sends the work round",
        detail:
          "Its condition holds, so the loop target runs again: a worker fresh with a `## Round n` section, a leader resuming its session.",
        docs: [ROLES.loops],
      },
      {
        from: "loop",
        to: "gate",
        title: "The gate asks you",
        detail:
          "From the run's terminal or `ork decide`; your `choice` picks its edge.",
      },
      {
        from: "gate",
        to: "reader",
        title: "The reader works where the change is",
        detail:
          "A readonly node looks back through gates and control nodes: it works in the loop target's worktree.",
        docs: [ROLES.upstream],
      },
      {
        from: "loop",
        title: "The loop runs out",
        detail:
          "After `maxRounds`, the loop target's owner, while working, or you are asked: stop the run, one more round, or carry on along the other edges.",
        docs: [ROLES.loops],
      },
    ],
  },
  {
    id: "owned",
    title: "A leader and its children",
    who: "Leader · owned children · spawned worker · sub-agent",
    summary:
      "How owned nodes run when their leader asks, where their work goes, and what is left after the run.",
    steps: [
      {
        from: "delegation",
        to: "leader",
        title: "The leader gets its tools",
        detail:
          "`delegate` and `spawn_worker`, both blocking: they return when every child has reported.",
        docs: [ENGINE.delegation],
      },
      {
        from: "leader",
        to: "child",
        title: "The leader delegates",
        detail:
          "Ork commits the leader's work first; the child works in its own worktree on a branch from it.",
        docs: [ROLES.delegation],
      },
      {
        from: "child",
        title: "The child reports to its leader",
        detail:
          "Only to its leader: a delegated run follows none of the child's edges.",
      },
      {
        from: "child",
        to: "merged",
        title: "Its work is merged",
        detail:
          "Into the leader's worktree, `--no-ff`, before `delegate` returns; its worktree goes after the run.",
        docs: [ROLES.afterRun],
      },
      {
        from: "leader",
        to: "spawned",
        title: "The leader spawns a worker",
        detail:
          "`<template>-2`, up to `maxWorkers`, working like its template in a worktree of its own.",
      },
      {
        from: "leader",
        to: "withEdges",
        title: "A child with edges runs either way",
        detail: "When delegated, and when one of its incoming edges is taken.",
      },
      {
        from: "withEdges",
        to: "subagent",
        title: "A sub-agent would stay in the session",
        detail: "Validated, but not yet passed to its owner's Claude session.",
        status: "partial",
        docs: [ROLES.subagent],
      },
      {
        from: "idle",
        title: "An idle child never runs",
        detail:
          "Its leader did not delegate to it; that is the leader's call, not a mistake.",
      },
      {
        from: "root",
        to: "kept",
        title: "The root's worktree stays",
        detail:
          "The leader has no owner, so its worktree, with its children merged in, is the run's result.",
        docs: [ROLES.afterRun],
      },
    ],
  },
  {
    id: "orphans",
    title: "Orphans, and what is not one",
    who: "Compiler · unreachable node · lone node · skipped node · idle child",
    summary:
      "Which nodes never run, which ones `ork validate` warns about, and the look-alikes that are fine.",
    steps: [
      {
        from: "compiler",
        to: "orphan",
        title: "`ork validate` warns",
        detail:
          "`graph.unreachable`: it has a way in, but no entry reaches it through edges or ownership.",
        docs: [ROLES.diagnostics],
      },
      {
        from: "orphan",
        title: "It never starts",
        detail:
          "Nothing activates it and nothing skips it; the run ends without it. Give it an edge from a node that runs, or a leader.",
      },
      {
        from: "scheduler",
        to: "lone",
        title: "A lone node is not an orphan",
        detail:
          "With no edges and no owner it is an entry, so it runs at the start.",
      },
      {
        from: "skipped",
        title: "Nor is a skipped node",
        detail:
          "It was reachable, but its ways in were not taken this round; it records `node.skipped`.",
        docs: [ROLES.activations],
      },
      {
        from: "idle",
        title: "Nor an idle child",
        detail:
          "Ownership reaches it, so no warning; it runs only if its leader delegates to it.",
      },
    ],
  },
];
