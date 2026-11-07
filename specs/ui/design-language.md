# The language

_Part of [Design system](./design-system.md)._

An instrument panel for agents, sized as a console: dense, precise, with a touch
of tech and pixel, and lit only where something needs the user
([ADR-055](../../decisions/ADR-055-console-language.md)).

- **Nested surfaces:** the canvas holds frames (8 px corner, 6 px apart). A
  frame holds its tabs and a card (6 px corner) inside a 3 px gutter, and a
  well, such as the graph's canvas with its dot grid, is set into a card.
  Surfaces do the separating, and hairlines are left for inside a card. A frame
  has an edge only in more contrast and forced colors, and a faint shadow only
  on the light theme.
- **Cards inside a panel:** a panel's toolbar, its main area, and anything else
  that stands alone each take a card, a 3 px gutter apart, rather than a
  hairline between them.
- **Rows:** a run takes 44 px, on two lines, and a log event 24 px. An event
  opens when clicked, so it stays at the minimum target size, though the
  prototype drew log lines at 20 px.
- **One toolbar inset:** whatever heads a card, in any panel, reads
  `--inset-tools`, so moving between tabs doesn't shift what's on them. A test
  holds this.
- **Small elements:** a top bar of 30 px, tabs of 26 px, a status bar of 22 px
  and controls of 24 px with 4 px corners. Sizes are for the default text size.
- **The brand pair, from the [logo](../../assets/logo/README.md):**
  - **Amber `#ffb000` is primary:** action and attention. Primary buttons,
    focus, and anything waiting on the user. A selected row is neutral, with an
    outline, so amber in a list always means it needs you.
  - **Phosphor `#3dff8a` is secondary:** live and done. Running, success, links.
  - **Text on either fill is the screen color `#0a0d0b`:** 10.7:1 on amber,
    14.8:1 on phosphor.
- **The name in the top bar is the identity, not text:** the small wordmark,
  `>▮ork`, redrawn on whole pixels for 32 px and under, with no background; on
  the light theme its green is `--phosphor-700`, and its caret stays amber
  ([logo](../../assets/logo/README.md)), on its own tile so it holds in every
  theme.
- **Two voices:** Geist for names and sentences, Geist Mono for values.
- **Titles, labels, descriptions and captions read as four things.** A title is
  strong and in text color: the panel's in `--text-title`, a section's in
  `--text-ui`. A label is `--text-small`, medium, in text color. A description
  is `--text-small`, regular and muted. A label says what a field is even with
  the description gone. A caption says what a value is, or heads a group: Geist
  Mono in `--text-caption`, upper case, tracked and muted, as a column's head, a
  stat's name or a section's heading. Never an identifier, as upper case would
  misstate it.
- **No side stripes.** Nothing is marked by a colored edge down one side of a
  card, a row or a message. A note is a line with its icon beside its first
  line, attention is a tint, a heavier weight or a word, and a problem is the
  failed glyph with its words. The one inside edge is the neutral hairline that
  shows nesting, as the Builder's groups do. A
  [test](../../packages/ui/test/side-stripes.test.ts) holds this.
- **Status is never color alone.** Each status has its own glyph, on a 5×5 pixel
  grid, and a word in mono; the colors are running and succeeded in phosphor,
  waiting and paused in amber, failed in red, and queued, skipped and
  interrupted in a neutral. A status sits bare among other facts, and is a
  tinted pill where it heads a view, as in a run's header.
- **Meters are blocks, not bars:** 20 of them, in phosphor, amber from 80% and
  red at the limit. Anything spent shows a block, and only the limit fills them
  all. The value is always in words too.
