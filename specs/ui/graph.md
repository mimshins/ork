# The graph

_Part of [The UI](../ui.md)._

Status: **Built:** the layout, the view, its keys and its accessible names
([graph](../../packages/ui/src/graph/), [tests](../../packages/ui/test/graph/)),
shown live in the [Monitor](./panels.md#monitor) and in the design system's
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
    to the right, and a node looping to itself gets an arc above it.
  - Loops and channels attach just off the middle of a side, apart from the
    flow.
- **Each kind has its own line,** so it reads without color: flow is solid, a
  loop dashed, an owner sparsely dashed, and a channel dotted with no arrowhead.
- **In a run, flow and owner edges show how far it has got:** live where the
  node they lead to has started, finely dotted where it hasn't, and with square
  packets moving in steps while it's running. That's all the motion means. With
  less motion the packets rest on the line.
- **Conditions** show on their edge, cut to 28 characters, with the whole of one
  in a hover title. A gap widens to fit the condition of a curve crossing it.
- **Nothing about it is stored.** A workflow is always drawn from its nodes and
  edges, so it looks the same in the Monitor and the Builder, and however it was
  written ([ADR-051](../../decisions/ADR-051-workflow-builder.md)).

## View

Edges are SVG and cards are buttons, in one layer that pans and zooms
([graph-view.tsx](../../packages/ui/src/graph/graph-view.tsx)). Cards are HTML
so they are real controls and share the status badge.

- **Moving it:** drag the canvas, scroll, or the arrow keys on the canvas. Zoom
  with a pinch, `⌘` or `Ctrl` and scroll, `+` and `-`, or the buttons. `0` or
  the fit button fits the drawing, which is never drawn bigger than life. Until
  the user moves it, it stays fitted as the panel resizes.
- **The dots belong to the drawing.** They move and scale with it, and every
  other one drops out when they would crowd together.
- **Rendering:** the transform is written straight to the layer in an animation
  frame, so moving the view renders nothing in React. React hears only when what
  is on screen changes, and draws just that, plus the card that Tab reaches.

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
- Zoom, fit and pan are buttons too, so none of it needs a drag (WCAG 2.5.7),
  and a node selected elsewhere comes into view. A node brought into view is
  never left under those buttons, and the focus ring keeps its thickness at any
  zoom (WCAG 2.4.11).
