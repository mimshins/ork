# Keeping the map in sync

The map describes the repository it lives in. It drifts when code lands and the
map doesn't, so resync after every milestone, and whenever a change builds,
moves or reshapes something a map shows. The `/resync-map` skill
(`.claude/skills/resync-map/`) runs this procedure.

## 1. See what changed

```sh
pnpm map:check
```

Besides validating the data, it prints:

- the commits since `synced` (in `public/js/data/sources.js`) that touch
  `packages/`, `docs/` or `examples/`, and any uncommitted changes there;
- **"Review these statuses"**: cards that are `specified` or `planned` but whose
  `src` path exists now. These are the first candidates to flip. A `partial`
  card is not listed (it is expected to have code); like a `built` one, it must
  link to that code.

To read a change: `git log -p <synced>..HEAD -- <path>`, or `git show <commit>`.

## 2. Decide which maps each change touches

| A change to…                                                       | Touches                                   |
| ------------------------------------------------------------------ | ----------------------------------------- |
| a package's public behaviour, a new package, the runtime drivers   | `architecture`                            |
| the scheduler, edges, joins, loops, escalation, tool or gate nodes | `lifecycle` (and `architecture`)          |
| the workflow file format or `examples/software-factory.ork.yaml`   | `lifecycle` (its nodes quote the example) |
| layers, precedence, `AGENTS.md`, the prompt order, limits          | `context`                                 |
| the bus, addressing, decisions, permissions, chat, Ork's MCP tools | `messaging`                               |
| feedback capture, triage, fixes, lessons, publishing               | `feedback` (and `messaging`, `context`)   |
| `docs/design.md` headings                                          | every map (anchors; the check finds them) |

## 3. Update the data

In `public/js/data/<map>/`:

- something got built → its `status` on the node, its edges and its journey
  steps; add a doc link to the code (and the test), and set `src` if missing;
- part of it got built → `partial`, with a fact saying what isn't;
- behaviour changed → `summary`, `facts`, `detail`;
- a file moved → its doc `path` (the check finds these);
- a new component → a node on the zone grid (see
  [design-language.md](design-language.md#layout)), its edges, and the journeys
  it belongs in; if it shows on several maps, `see` links both ways.

Read the code, not the commit message: a status follows what the code and its
tests do. Every new fact gets a doc link.

## 4. Record the sync

In `public/js/data/sources.js`, set `synced` to the commit you reviewed
(`git rev-parse --short HEAD`) and `SYNCED_ON` to today. The legend shows both.

## 5. Check and look

```sh
pnpm map:check   # must end with ✓
pnpm map         # http://localhost:8791/#<map>
```

Open every map you touched, in light and dark. Look for overlapping labels,
edges crossing cards, and cut-off subtitles (they get an ellipsis and a
tooltip).

## 6. Commit

`Sync the interaction map to <sha>`, with a body listing per map what changed
(status flips, new cards and journeys).
