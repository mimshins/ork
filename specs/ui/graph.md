# The graph

_Part of [The UI](../ui.md)._

Status: **Built:** the layout, the view, its keys (listed by its Keys button)
and its accessible names ([graph](../../packages/ui/src/graph/),
[tests](../../packages/ui/test/graph/)), shown live in the
[Monitor](./panels-runs-and-monitor.md#monitor) and in the design system's
gallery. It is Ork's own, not React Flow, so the state stays in
containerized-state ([ADR-040](../../decisions/ADR-040-ui-stack.md)).

## Layout

[`layoutGraph`](../../packages/ui/src/graph/layout.ts) is a pure function of the
workflow, and tested on the example workflows.

- **Ranks run left to right,** by longest path. Loop edges (`maxRounds`) are
  left out of that, and an owner counts as coming before a node nothing flows
  into.
- **Order within a rank** is by barycenter, to cut crossings. A long edge has a
  stop on each rank it crosses, for this only.
- **Heights** keep each rank's order and spacing while pulling a node level with
  what it joins, and a node moves level with the one before it, or a first node
  with the one after it, when that is a small step.
- **Edges follow the interaction map's style**
  ([design language](../../docs/interaction-map/design-language.md)), and never
  climb in steps:
  - Nodes on neighboring ranks get one smooth curve between their facing sides.
    Where their sides overlap enough, it's a straight line across what they
    share, so a small offset never makes a shallow S.
  - A longer edge runs level along one lane through the ranks it crosses, clear
    of their cards, with at most four rounded corners.
  - A loop goes right to left, a channel between two nodes of a rank bulges out
    to the right, and a node looping to itself gets an arc above it, with extra
    room above the card and its condition wrapped to the card's width.
  - Loops and channels attach just off the middle of a side, apart from the
    flow.
- **Each kind has its own line,** so it reads without color: flow is solid, a
  loop dashed, an owner sparsely dashed, and a channel dotted with no arrowhead.
- **In a run, flow and owner edges show how far it has got:** live where the
  node they lead to has started, finely dotted where it hasn't, and with square
  packets moving in steps while it's running. That's all the motion means. With
  less motion the packets rest on the line.
- **Conditions** show whole on their edge, wrapped at spaces to lines of 28
  characters. A gap widens to fit the condition of a curve crossing it.
- **Nothing about it is stored.** A workflow is always drawn from its nodes and
  edges, so it looks the same in the Monitor and the Builder, and however it was
  written ([ADR-051](../../decisions/ADR-051-workflow-builder.md)).

## View

Edges are SVG and cards are buttons, in one layer that pans and zooms
([graph-view.tsx](../../packages/ui/src/graph/graph-view.tsx)). Cards are HTML
so they are real controls and share the status badge.

- **A card** is 152 × 60 px ([types.ts](../../packages/ui/src/graph/types.ts))
  and has three lines: its head (type, id, cost), the task label a delegating
  leader gave it (`description`, muted, one line with an ellipsis; about 20
  characters show, [gaps](../gaps.md)), and its status. A card with no label
  leaves that line out. The whole label, with the status, is in the card's
  tooltip.

- **Moving it:** drag the canvas, scroll, or the arrow keys on the canvas. Zoom
  with a pinch, `⌘` or `Ctrl` and scroll, `+` and `-`, or the buttons. `0` or
  the fit button fits the drawing, which is never drawn bigger than life. Until
  the user moves it, it stays fitted as the panel resizes.
- **The dots belong to the drawing.** They move and scale with it, and every
  other one drops out when they would crowd together.
- **Rendering:** the transform is written straight to the layer in an animation
  frame, so moving the view renders nothing in React. React hears only when what
  is on screen changes, and draws just that, plus the card that Tab reaches.

## A node with `forEach`

Status: **built** for [for-each](../scheduler/for-each.md)
([facts.ts](../../packages/ui/src/graph/facts.ts),
[node-card.tsx](../../packages/ui/src/graph/node-card.tsx),
[monitor-model.ts](../../packages/ui/src/panels/monitor-model.ts)).

A fanned node is **one card**, as in the file. Its items (`build.0` to
`build.7`) are tree rows in the
[node table](./panels-runs-and-monitor.md#items-of-a-fanned-node), never cards,
so `graphInputOf` skips them, and the drawing does not change as items start.

- **The status line** is the card's glyph and, in place of the status's word,
  the progress: `3 of 8`, or `3 of 8, 1 failed`. The glyph is the node's own
  status, so it still reads without color. Before the node has listed its items
  (`each.listed`), the card is an ordinary one, and a run from before that event
  draws as before.
- **The count:** the first number is the items that ended (succeeded, failed or
  skipped), the second is the list's length, and the last is how many of the
  ended ones failed. A stopped or finished node keeps its final counts, and an
  empty list reads `0 of 0`.
- **It fits the line:** one string, `progressText`, feeds the card, the name and
  the tip. Past 18 characters its "of" becomes a slash (`120/400, 11 failed`),
  and past what the line holds it is cut with an ellipsis at the end.
- **Failures stay quiet:** an item that failed does not light the card. Its tone
  is the node's status, so a running node with one failed item keeps the running
  look and says `1 failed` in words; the card turns failed only when the node
  fails. Amber stays for what needs the user.
- **Name:** `build, running, 3 of 8, 1 failed, $0.4100, 12.0k tokens, worker`.
  The status word stays in the name, after the id, and the progress holds what
  is on screen word for word (WCAG 2.5.3). The card shows the progress in place
  of the word, so the word lives in the tip as well
  (`running · 3 of 8, 1 failed`), and a paused or waiting card is not left with
  only its icon.
- **An item selected elsewhere** (in the table) marks its node's card as holding
  it: the selected look's border color with a dashed border, on `.card`'s tokens
  (`--graph-card-border-color: var(--color-text)`,
  `--graph-card-border-style: dashed`), and no new color. The card is not
  `aria-selected`; the table row is, since it is what the selection names. The
  card is brought into view, as for any node selected elsewhere. The dashed
  border is a visual cue only: the table row's `aria-selected` is the signal for
  assistive technology. In forced colors the border is `Highlight`.

## Keys and names

The canvas is one tab stop and the cards are another, with a roving tabindex.

- On a card, the arrow keys move along its edges; up and down also reach the
  card above or below on its rank. Moving there brings it into view.
- `Enter` or `Space` selects. The context-menu key, `Shift+F10` or a right click
  asks for the node's controls. `Escape` goes back to the canvas.
- Each card's accessible name says its id, status, model, tokens, cost and type,
  with what the card shows first, so the name holds what is on screen (WCAG
  2.5.3). A status has an icon and a word as well as its color.
- The canvas is an `application`, since it takes its own keys, with a
  description of them. Edges are hidden from assistive technology, and each
  card's description says them instead: "after a; leads to b if exitCode == 0".
  The Monitor's node table says the same, and is the screen-reader-first twin of
  the graph, with the same data and actions.
- **Keys**, beside the view's buttons, opens a popover that lists every key the
  graph takes, on the view and on a card, since a card's keys have no button
  whose tooltip could show them, and the canvas's description reaches only a
  screen reader.
- Zoom, fit and pan are buttons too, so none of it needs a drag (WCAG 2.5.7),
  and a node selected elsewhere comes into view. A node brought into view is
  never left under those buttons, and the focus ring keeps its thickness at any
  zoom (WCAG 2.4.11).
