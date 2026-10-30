# The maps

Each map answers one question. Keep a card on the map whose question it helps
answer; when the same thing matters on two maps, draw it on both and link the
two cards with `see`.

| Id             | Title                   | The question it answers                                           | Zones, left to right                                                               |
| -------------- | ----------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `architecture` | Architecture            | What are Ork's parts, and who talks to whom when a workflow runs? | People · CLI and UI · Ork engine · Your machine · Claude runtime · Model providers |
| `lifecycle`    | Run lifecycle           | What happens, step by step, when you run a workflow?              | You · Ork engine · the run graph · Repo and GitHub                                 |
| `context`      | Context and skills      | What does one node's session see, where from, and in what order?  | Layers · Context compiler · Session spec · The session and after                   |
| `messaging`    | Messaging and decisions | How do nodes talk to each other and to you?                       | You · CLI and UI · Ork engine · Runtime · Node sessions                            |

## Per map

### `architecture`

Every package and process: the CLI, the planned server and UI; the engine's
subsystems (graph compiler, schema, scheduler, context compiler, message bus,
decision queue, worktree manager, node types, event store); the files and CLIs
on your machine; the runtime adapter, its two drivers and Ork's MCP tools; the
Claude session and the model providers. Rows 3–5 of "Your machine" stay empty as
a corridor for the engine–runtime edges. Journeys: validating a file, and one
Claude node from start to report.

### `lifecycle`

The `software-factory` example laid out as its run graph, with the engine pieces
a run passes through on the left and the builder's worktree and GitHub on the
right. Edges inside the graph are the example's flow edges. Journeys: the happy
path, the bounded review loop and its escalation, and the human gate.

### `context`

The five layers stacked from lowest to highest precedence (the edges down the
first column show precedence, not calls), the owner's brief, the compiler's
steps, the parts of the session spec, and the session, its report and the
artifact store. Journeys: compiling the security reviewer's session, and a
workflow skill shadowing a project skill.

### `messaging`

You and the commands you chat and answer from; the bus, address check, priority
gate and decision queue; `Session.send`, Ork's tools and the permission gate;
three node sessions from the example. Journeys: a sibling message, `ask_user`, a
permission prompt, and chatting with the builder.

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
