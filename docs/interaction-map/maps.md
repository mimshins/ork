# The maps

Each map answers one question. Keep a card on the map whose question it helps
answer; when the same thing matters on two maps, draw it on both and link the
two cards with `see`.

| Id             | Title                   | The question it answers                                           | Zones, left to right                                                               |
| -------------- | ----------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `architecture` | Architecture            | What are Ork's parts, and who talks to whom when a workflow runs? | People · CLI and UI · Ork engine · Your machine · Claude runtime · Model providers |
| `lifecycle`    | Run lifecycle           | What happens, step by step, when you run a workflow?              | You · Ork engine · the run graph · Repo and GitHub                                 |
| `roles`        | Node roles              | Where can a node sit in a workflow, and when does it run?         | Ork engine · In the flow · In the tree · What a run leaves                         |
| `context`      | Context and skills      | What does one node's session see, where from, and in what order?  | Layers · Context compiler · Session spec · The session and after                   |
| `messaging`    | Messaging and decisions | How do nodes talk to each other and to you?                       | You · CLI and UI · Ork engine · Runtime · Node sessions                            |
| `feedback`     | Feedback loop           | How does a run's friction become a fix, a lesson or a report?     | You · CLI and UI · Ork engine · Your machine · Claude runtime · GitHub             |

## Per map

### `architecture`

Every package and process: the CLI, the server and the UI; the engine's
subsystems (graph compiler, schema, scheduler, context compiler, message bus,
decision queue, worktree manager, node types, event store, workflow calls, links
between runs, a `watch:` on a node); the files and CLIs on your machine; the
runtime adapter, the session runner every driver shares, the three drivers (two
unproven), the contract suite and Ork's MCP tools; the Claude session and the
model providers. The bottom row is `ork watch`, from outside any run: the
command, the watcher and its guards, accepting a trigger, and the trigger files.
Rows 3–5 of "Your machine" stay empty as a corridor for the engine–runtime
edges. Journeys: validating a file, one Claude node from start to report, a
workflow calling a workflow, and a trigger starting a run.

### `lifecycle`

The `software-factory` example laid out as its run graph, with the engine pieces
a run passes through on the left (called runs and a wait on a source among them,
though the example has neither) and the builder's worktree and GitHub on the
right. Edges inside the graph are the example's flow edges. Journeys: the happy
path, the bounded review loop and its escalation, the human gate, and a node
waiting on a source.

### `roles`

Each card is a role a node can take, not one node: in the flow (entry, middle
node, leaf, lone node, router, join, loop target, gate, skipped node,
unreachable node, readonly reader, call) and in the ownership tree (leader,
ownership root, owned child, child with edges, spawned worker, sub-agent, idle
child), with the compiler, scheduler and delegation that decide when each runs,
and the summary, kept worktrees and merged children a run leaves. Its facts say
how to write a node into the role. Journeys: from the entries to the leaves; a
dead path, a loop and a gate; a leader and its children; orphans and what is not
one.

### `context`

The five layers stacked from lowest to highest precedence (the edges down the
first column show precedence, not calls), the owner's brief, the compiler's
steps, the parts of the session spec, and the session, its report and the
artifact store. Journeys: compiling the security reviewer's session, and a
workflow skill shadowing a project skill.

### `messaging`

You and the commands you chat and answer from; the bus, address check, priority
gate and decision queue; `Session.send`, Ork's tools and the permission gate;
three node sessions from the example; and along the bottom, what reaches another
run: `ork relay`, links, the other run, a linked node and a channel to a call.
Journeys: a sibling message, `ask_user`, a permission prompt, chatting with the
builder, and two runs talking over a link.

### `feedback`

The feedback and self-improvement loop. The three sources (system signals from
the event store, the agent's `feedback` tool, your notes), the recorder that
masks and fingerprints them, and the local `feedback` table that groups records
into items; `ork feedback`, its actions, and the Feedback panel; triage by
rules, fixes through Ork's own `ork:feedback-apply` workflow and its gate,
lessons, and the publish preview you confirm; the lessons file the context
compiler reads into the workflow layer, the repo files a fix changes, JSONL
export, and your `gh` posting to the "Agent feedback" Discussions category. All
of it is `built`; the maintainers' own triage of the category is not part of
Ork. Rows 1, 2 and 4 of "Your machine" and all but row 2 of "Claude runtime"
stay empty as corridors. Journeys: an agent reports friction, triage then a
lesson, applying a fix, publishing to Ork's Discussions, and a fix and a publish
from the Feedback panel.

## Adding a map

1. Make `public/js/data/<id>/` with `map.js`, `nodes.js`, `edges.js` and
   `journeys.js` (copy any existing map's files for the shape).
2. Import it in `public/js/data/maps.js` and place it in `MAPS`; the order is
   the switcher's order, and the first map is the one a bare URL opens.
3. Lay it out following [design-language.md](design-language.md#layout) and
   write it following [content-style.md](content-style.md).
4. Link it both ways with `see` from the cards it shares with other maps.
5. Add it to the table above, to [README.md](README.md), and to the triage table
   in [sync.md](sync.md).
6. `pnpm map:check`, then look at it in the browser.
