# Design language

How the maps look and why, so a new map or a restyle stays of a piece with the
rest. The values live in `public/css/styles.css`; this explains them.

## Principles

- **Calm canvas, colour carries meaning.** The background is a quiet dotted
  grid. Colour is spent only on what it encodes: a zone's tone, an edge's kind,
  a status, a journey. Nothing is colourful for decoration.
- **One idea per encoding.** Zone → card tint. Edge kind → line colour and dash.
  Status → the dot on the card and the pill in the panel. Journey → pink. Don't
  reuse one of these channels for something else.
- **Focus by dimming, not by adding.** Selecting or hovering a card lights it
  and its neighbours and fades everything else to ~8%. Journeys and the status
  filter work the same way.
- **The map is the index; the panel is the page.** Cards carry a title and a
  one-line sub only. Everything else (summary, facts, addresses, connections,
  docs) lives in the side panel.
- **Light and dark are equals.** Every colour is a token on `:root`, redefined
  for dark under `prefers-color-scheme` and `[data-theme="dark"]`. `T` toggles;
  `?theme=light` forces one.
- **Leave corridors.** Where two zones talk across a third, keep a row of the
  middle zone empty so the edges run straight (see the architecture map's "Your
  machine" column).

## Tokens

| Token family                                          | Use                        | Light example    | Dark example     |
| ----------------------------------------------------- | -------------------------- | ---------------- | ---------------- |
| `--bg`, `--canvas`, `--panel`, `--panel-2`, `--glass` | surfaces                   | `#f4f5f7` canvas | `#111110` canvas |
| `--ink`, `--ink-2`, `--muted`                         | text, strongest to weakest | `#1f2328`        | `#f2f2f0`        |
| `--line`, `--line-2`                                  | borders                    | `#d0d7de`        | `#3a3a37`        |
| `--z-*`                                               | zone tones (below)         |                  |                  |
| `--k-*`                                               | edge kinds (below)         |                  |                  |
| `--st-*`                                              | statuses (below)           |                  |                  |
| `--journey`, `--journey-soft`                         | everything journey         | `#d6336c`        | `#f06595`        |

### Zone tones

A zone (column) has a `tone`; its cards, label, search results and panel header
take it. Pick tones so neighbouring zones differ.

| `tone`   | Used for                                                 |
| -------- | -------------------------------------------------------- |
| `violet` | you                                                      |
| `blue`   | the CLI and the UI                                       |
| `orange` | the Ork engine (`@krapht/ork-core`, `@krapht/ork-nodes`) |
| `teal`   | the Claude runtime, the run graph, the session spec      |
| `amber`  | model providers, node sessions, what happens after       |
| `slate`  | your machine: files, worktrees, CLIs; the layers         |

### Edge kinds

| Kind      | Line               | Meaning                                    |
| --------- | ------------------ | ------------------------------------------ |
| `net`     | solid grey         | HTTP or SSE on localhost, or a network API |
| `local`   | solid light grey   | in-process call                            |
| `message` | blue dots          | an Ork bus message between sessions        |
| `process` | solid amber        | spawning a process and talking over stdio  |
| `mcp`     | solid green        | an MCP tool call to Ork's tools            |
| `file`    | violet dashes      | reading or writing files                   |
| `human`   | grey round dots    | a person using the CLI or the UI           |
| `event`   | cyan dash-dot      | run events, appended and streamed          |
| `git`     | indigo long dashes | git: worktrees, branches, merges           |

`specified` and `planned` edges are drawn dashed and faded whatever their kind.
A lit edge animates its dashes in the direction of flow. The legend lists only
the kinds the current map uses.

### Statuses

| Status      | Token            | Dot          |
| ----------- | ---------------- | ------------ |
| `built`     | `--st-built`     | filled green |
| `partial`   | `--st-partial`   | teal ring    |
| `specified` | `--st-specified` | blue         |
| `planned`   | `--st-planned`   | amber        |
| `external`  | `--st-external`  | grey         |

## Type

- **Inter** for everything (`--font`), 14px base; weights 400–700, headings
  ~650.
- **JetBrains Mono** (`--mono`) for code, paths, group labels and repo chips.
- Zone labels: 12.5px, 650, uppercase, wide tracking, in the zone's tone.
- Text in data uses backticks for code; the renderer turns them into `<code>` in
  HTML and strips them in SVG.

## Cards

- 220 × 72 map units (`NODE_W`, `NODE_H` in `types.js`); `w` may widen a card
  (keep to 240–300). Height never changes.
- Rounded 13, a 3.5-unit accent bar in the zone tone on the left, title
  (15px, 650) at y 31, sub (12px) at y 51, status dot bottom right, optional
  package chip (`core`, `runtime-claude`, …) on the top edge, as wide as its
  name.
- Titles and subs that overflow are cut with an ellipsis and get a tooltip, so
  keep titles ≤ ~22 characters and subs ≤ ~30.

## Layout

Coordinates are map units, the SVG's user space; `SIZE` is the map's extent.

- **Zones are full-height columns**, left to right in the direction things flow
  (you → CLI and UI → the engine → your machine → the runtime → providers). Zone
  labels sit at y 26, so the first row of cards starts around y 96–120. Leave
  ~20 units between zones; a card must sit wholly inside its zone.
- **A grid within each zone**: rows about 110–130 apart, columns 240–260 apart.
  Keep ≥ 30 units between cards (the check fails under 12).
- **Groups** are dashed boxes around things that run together or ship together
  (a package, a process, an owner's children). Pad ~20 around their cards and
  leave ~30 above for the label. Groups may nest.
- **Edges** without `via` are curves between the facing sides of two cards. Long
  edges get `via` corner points drawn as straight segments with rounded corners:
  consecutive points share x or y; put the first and last corner level with (or
  in line with) the card they attach to, and run lanes through the gaps between
  cards and groups. Look at the existing `via` routes for lanes in use before
  adding one.
- **12–35 cards per map.** If a map needs more, it is two maps.

## Chrome

Floating glass panels over the canvas: brand and map switcher top left,
journeys, search and theme top right, legend bottom left, zoom bottom right, the
details panel on the right (a bottom sheet under 760px), the journey stepper
bottom centre. All of them stay out of the way of `fit()` via the map's
`insets()`.

## Motion

Short and eased (≈ 0.2–0.4 s, cubic ease-out). Everything respects
`prefers-reduced-motion`: animation and transitions are switched off.
