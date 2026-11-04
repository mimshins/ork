# ADR-055 — The console's language: frames, cards and two voices

- **Status:** Accepted
- **Date:** 2026-11-05
- **Topic:** UI / design system / how the console looks
- **RFC:** waived: the maintainer decided this directly, from a prototype

## Context

The first design language was "dark, quiet and dense": panels on a near-black
canvas, separated by hairlines, with shadows ruled out. It holds up, but every
panel and every section in it looks alike, so nothing says what sits inside what
and a dense screen reads as one flat sheet.

The maintainer asked for a language closer to a set of reference videos, with a
touch of tech and pixel in it. Those references are spacious, and Ork is a
console that has to fit a lot on a screen, so a prototype of the Monitor was
drawn at console density and accepted before any of this was applied.

## Decision

**A panel is a frame holding a card, type has two voices, and the pixel touches
stay small and carry meaning.**

- **Nested surfaces.** The canvas holds frames (8 px corner, 6 px apart). A
  frame holds its tabs and a card (6 px corner) inside a 3 px gutter, and a
  well, such as the graph's canvas, is set into a card. Surfaces do the
  separating, and hairlines are left for inside a card. A frame has no edge of
  its own except in more contrast and forced colors. On the light theme it has a
  faint shadow; on the dark theme it has none.
- **Two voices.** Geist 13 for names and sentences, Geist Mono 12 for values. A
  caption is what says what a value is: Geist Mono 11, upper case, tracked
  `.04em`, muted. An identifier never becomes a caption, because upper case
  would misstate it.
- **Small elements.** A top bar of 30 px, tabs of 26 px, a status bar of 22 px,
  controls of 24 px with 4 px corners.
- **Pixel touches, no pixel font.** Status glyphs on a 5×5 grid, meters in
  blocks, square packets on edges, dotted pending edges and a dot grid in wells.
  These land with their components after this step, and each still pairs with a
  word.
- **The brand pair doesn't change.** Amber for action and attention, phosphor
  for live and done, and every status keeps its own shape and word.

The values live in the tokens ([ADR-054](./ADR-054-component-tokens.md)), so the
language is mostly a change of values. The contrast tests hold it in all four
looks.

## Consequences

- **Status glyphs are drawn here, not taken from Material Design Icons,** which
  is the one exception to [ADR-042](./ADR-042-icons-mdi.md): its icons blur at
  10 px, and a 5×5 grid stays crisp. Everything else still comes from MDI.
- **Packets on an edge mean its node is running,** and nothing else. Motion that
  meant nothing would only teach people to ignore it, and one packet per tool
  call would have the Monitor reading the event stream as well as the tree.
- **The active group keeps its amber line,** which the prototype didn't have.
  Tab weight alone can't say which group the keyboard is in.
- **A control's border is the quieter line.** A button has its word or icon to
  identify it, so its border needn't reach 3:1. A field's box keeps the stronger
  border, because its edge is the only thing that shows it's there.
- **Dockview gets its gap from a number,** not a token. Below or above the
  default text size the 6 px gap stays 6 px while the rest scales, like the
  graph's geometry.
- **It lands in steps:** values first, then the shared pieces (status glyphs,
  meters, pills), then the panels, then the Monitor. Until the last one the
  console is a mix, in which the frames and captions are new and the panels'
  insides are not.

## Alternatives considered

- **Keep hairlines and change only the colors.** The least work, but it leaves
  the flat sheet that started this.
- **The references' spacing as drawn.** The maintainer turned this down: "our
  web app is a console app which needs small elements to fit".
- **A pixel font for captions.** A strong identity, and hard to read at 11 px,
  so the pixels stay in glyphs and meters, and captions stay in Geist Mono.
