# Ork interaction map

Interactive maps of how Ork fits together, for onboarding and for auditing the
build as it goes. Pick one with the map switcher (`M`):

| Map                         | What it shows                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Architecture**            | You, the CLI, server and UI, the engine, the files and CLIs on your machine, the Claude runtime and the model providers. |
| **Run lifecycle**           | One run of the `software-factory` example, from `ork run` to a merge, a review loop, or a decision.                      |
| **Context and skills**      | The five layers and their precedence, and how one node's session is compiled.                                            |
| **Messaging and decisions** | How nodes message each other and you, and how every question reaches one inbox.                                          |
| **Feedback loop**           | How a run's friction is captured, grouped, and turned into fixes, lessons, or a post to Ork's Discussions (planned).     |

The **roadmap** page (`roadmap.html`, linked from the top bar) shows the
milestones, what has shipped and when, and what is left
([roadmap.md](roadmap.md)).

Click any card or connection for what it is, what it holds and guarantees, what
it talks to, and links into the repository. **Journeys** walk through a flow
step by step on the same map. Every card has a status (built, partly built,
specified, planned, external): the map says what exists today, not only what is
designed.

| Path                      | What it is                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `public/index.html`       | The page: markup only.                                                                                                    |
| `public/roadmap.html`     | The roadmap page, rendered by `public/js/roadmap.js` from `public/js/data/roadmap.js`.                                    |
| `public/css/tokens.css`   | The colour, type and shadow tokens both pages share (light and dark).                                                     |
| `public/css/styles.css`   | The map's styles; `roadmap.css` adds the roadmap's.                                                                       |
| `public/js/data/`         | **All the content**: `types.js` (the data model), `maps.js` (the list), `refs.js` (shared doc links), one folder per map. |
| `public/js/*.js`          | The renderer: `map` (SVG, pan and zoom), `panel`, `journey`, `model`, `main`.                                             |
| `tools/check.mjs`         | Validates every map, doc link and status, and lists what changed since the sync.                                          |
| `tools/check-roadmap.mjs` | Validates the roadmap's commits, dates and links, and lists commits no item names.                                        |
| `tools/serve.mjs`         | A dependency-free static server for local viewing.                                                                        |
| `*.md` here               | Content style, design language, the maps, the sync procedure.                                                             |

Plain HTML, CSS and ES modules: no build step and no dependencies. The renderer
comes from the SuperEngine interaction map.

## Run it

```sh
pnpm map          # http://localhost:8791
pnpm map:check    # validate data, links and statuses
```

ES modules do not load from `file://`; use the server.

## Controls

| Input                               | Action                                         |
| ----------------------------------- | ---------------------------------------------- |
| drag · scroll                       | pan                                            |
| ⌘/Ctrl + scroll · pinch · `+` / `-` | zoom                                           |
| `0` or `F`                          | fit the whole map                              |
| click a card or a line              | details in the side panel                      |
| `M`                                 | switch map                                     |
| `J`                                 | journeys                                       |
| `←` / `→` · `Space`                 | previous / next step · play (in a journey)     |
| `/`                                 | find a component or journey, on any map        |
| `T`                                 | toggle light / dark (`?theme=light` forces it) |
| `Esc`                               | close the menu, the panel, or the journey      |

Every view has a link: `#lifecycle`, `#architecture/node/schema`,
`#architecture/edge/scheduler-runtime`, `#messaging/journey/ask-user/3`. Click a
status in the legend to highlight everything built, specified, planned, and so
on.

## Keeping it true

When code lands, the map must follow: [sync.md](sync.md), or the `/resync-map`
skill in Claude Code. How to write content:
[content-style.md](content-style.md). How it looks:
[design-language.md](design-language.md). What each map covers and how to add
one: [maps.md](maps.md).
