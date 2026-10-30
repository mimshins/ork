# Ork logo

The mark is a prompt: a `>` and an amber block caret, drawn as two glyphs of the
logotype's own pixel font. Beside the type it reads `>▮ork`, Ork's prompt set in
Ork's type. The chevron is your request; the caret is the owner waiting to hand
it on. Phosphor green and amber on a dark tube, with a faint glow and scanlines,
like a terminal on a CRT.

## Type

"ork" is pixel type, monospaced like a terminal's text mode. Each glyph is hand
built on a 5×7 grid with a 6-cell advance, so every letter is the same width.
Its pixels are squares with a thin gap. The rows line up with the scanlines:
each pixel carries one scanline through its middle, and the gaps fall on the
next. The mark uses the same grid at the same pixel size in the wordmark, so
mark and type are one system. There is no font to install; the letters are
paths.

## Files

| File                          | Use it for                                                    |
| ----------------------------- | ------------------------------------------------------------- |
| `ork-mark.svg`                | The default mark on its screen: avatars, social cards, docs   |
| `ork-mark-transparent.svg`    | Dark backgrounds only; phosphor green is too faint on white   |
| `ork-wordmark.svg`            | The README header and banners: the mark and the pixel "ork"   |
| `icons/favicon.svg`           | Browser tabs: the mark redrawn on a 16 px grid, on its tile   |
| `icons/favicon.ico`           | The fallback favicon: the 16 px drawing at 16, 32 and 48 px   |
| `icons/apple-touch-icon.png`  | iOS home screen, 180 px, opaque (iOS rounds the corners)      |
| `icons/icon-192.png`, `-512`  | Android and PWA icons, rounded tile with transparent corners  |
| `icons/icon-maskable-512.png` | Android adaptive icon: full bleed, mark inside the 80% circle |
| `icons/site.webmanifest`      | The web app manifest naming those icons                       |

## Regenerate

`node assets/logo/tools/generate.mjs` writes every file above from
[draw.mjs](./tools/draw.mjs), and copies the favicons into the interaction map's
`public/` folder. PNGs are rendered with the Google Chrome on your machine
(headless; set `CHROME` for another Chromium); there is no npm dependency.

## Colors

| Name     | Hex       | Role                             |
| -------- | --------- | -------------------------------- |
| Screen   | `#0a0d0b` | Background, the edge of the tube |
| Screen   | `#112016` | Background, its lit centre       |
| Phosphor | `#3dff8a` | The chevron and the type         |
| Amber    | `#ffb000` | The caret: the owner             |

## Rules

- Keep the mark on its screen, or on a background at least as dark as `#1a1a19`.
- Do not recolour, stretch, or add effects; scale it as a whole.
- Below 32 px use the favicon drawing, not a scaled-down mark.
