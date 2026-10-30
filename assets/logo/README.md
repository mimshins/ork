# Ork logo

The mark is **fan**: one owner, three beams fanning out to the nodes it owns,
drawn like a trace on a vector display. The owner glows amber with a white-hot
core, and the beams cool from bright to dim green the way phosphor decays. It is
Ork in one glyph: an owner hands work down, and its children report back.

## Files

| File                       | Use it for                                                            |
| -------------------------- | --------------------------------------------------------------------- |
| `ork-mark.svg`             | The default: favicon, avatar, app icon, any background                |
| `ork-mark-transparent.svg` | Dark backgrounds only; phosphor green is too faint on white           |
| `ork-wordmark.svg`         | The README header and banners: the mark and "ork" on a dark screen    |
| `ork-mark-orbit.svg`       | Alternative direction: a broken beam ring, the "o" of ork             |
| `ork-mark-scan.svg`        | Alternative direction: an indented tree in scanlines, like `ork tree` |
| `ork-mark-fan.svg`         | The chosen direction, the same as `ork-mark.svg`                      |

The marks are drawn on a 64-unit grid and read at 16px. The glow is one Gaussian
blur filter and the scanlines are a pattern, so they render as plain SVG
anywhere, including GitHub.

## Colors

| Name      | Hex       | Role                             |
| --------- | --------- | -------------------------------- |
| Screen    | `#0a0d0b` | Background, the edge of the tube |
| Screen    | `#112016` | Background, its lit centre       |
| Phosphor  | `#3dff8a` | Beams and children (P1 green)    |
| Decay     | `#24a85a` | The faded beam                   |
| Amber     | `#ffb000` | The owner (P3 amber)             |
| Beam core | `#e6fff0` | The owner's white-hot centre     |

## Rules

- Keep the mark on its screen, or on a background at least as dark as `#1a1a19`.
- Do not recolour, stretch, or add effects; scale it as a whole.
- Leave clear space of at least a quarter of the mark's width around it.
