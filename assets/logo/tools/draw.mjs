/**
 * @file Draws Ork's logo as SVG text: the prompt mark (a ">" and a block caret
 *   on the pixel grid of the "ork" logotype), the mark without its screen, the
 *   wordmark, and the favicon redrawn for 16 px. Pure functions; generate.mjs
 *   writes and rasterizes them.
 */

export const C = {
  screen: "#0a0d0b",
  screenCore: "#112016",
  green: "#3dff8a",
  amber: "#ffb000",
};

/** The logotype's pixel pitch in the wordmark; 4.4 of each 5 units are lit. */
const TYPE_CELL = 5;
/** The mark's scale in the wordmark, so its pixels match the type's. */
const LOCKUP_SCALE = 0.8125;
/** The tile is 64 units; the mark's pixel pitch in those units. */
const MARK_CELL = TYPE_CELL / LOCKUP_SCALE;

/** The mark: ">" and a block caret, two glyphs of the logotype's 5x7 font. */
const MARK_ROWS = [
  "g.......",
  ".g......",
  "..g..aaa",
  "...g.aaa",
  "..g..aaa",
  ".g...aaa",
  "g....aaa",
];

/** The same mark redrawn for 16 px, one unit a pixel, centred on the tile. */
const FAVICON_ROWS = [
  "................",
  "................",
  "................",
  "................",
  "...gg...........",
  "....gg..........",
  ".....gg.........",
  "......gg..aaaa..",
  ".......gg.aaaa..",
  "......gg..aaaa..",
  ".....gg...aaaa..",
  "....gg....aaaa..",
  "...gg.....aaaa..",
  "................",
  "................",
  "................",
];

/** @type {Record<string, string[]>} The "ork" logotype: 5x7 glyphs. */
const GLYPH_ROWS = {
  o: [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
  r: [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  k: ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
};

/** @type {Record<string, string>} */
const COLORS = { g: C.green, a: C.amber };

/**
 * Each lit cell of `rows`, with its column, row and colour.
 *
 * @param {readonly string[]} rows
 * @returns {{ x: number; y: number; fill: string }[]}
 */
const cells = rows =>
  rows.flatMap((row, y) =>
    row.split("").flatMap((ch, x) => {
      const fill = COLORS[ch];
      return fill === undefined ? [] : [{ x, y, fill }];
    }),
  );

/** @param {string} id */
const defs = id => `
  <defs>
    <radialGradient id="${id}-screen" cx="50%" cy="45%" r="70%">
      <stop offset="0" stop-color="${C.screenCore}"/>
      <stop offset="1" stop-color="${C.screen}"/>
    </radialGradient>
    <filter id="${id}-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <pattern id="${id}-scan" width="4" height="2.5" patternUnits="userSpaceOnUse">
      <rect width="4" height="0.8" fill="#000" opacity="0.16"/>
    </pattern>
  </defs>`;

/** @param {number} n */
const num = n => Number(n.toFixed(2)).toString();

/**
 * The mark's pixels, centred on (32, 32) and scaled by `scale` about it. Each
 * pixel leaves a 0.6-unit gap, and rows start 0.6 past a scanline.
 *
 * @param {number} scale
 */
const markPixels = (scale = 1) => {
  const cell = MARK_CELL * scale;
  const gap = 0.6 * scale;
  const cols = Math.max(...MARK_ROWS.map(r => r.length));
  const x0 = 32 - (cols * cell - gap) / 2;
  const y0 = 32 - (MARK_ROWS.length * cell - gap) / 2;
  return cells(MARK_ROWS)
    .map(
      ({ x, y, fill }) =>
        `<rect x="${num(x0 + x * cell)}" y="${num(y0 + y * cell)}" width="${num(cell - gap)}" height="${num(cell - gap)}" fill="${fill}"/>`,
    )
    .join("");
};

/**
 * @param {string} id
 * @param {string} inner
 */
const glow = (id, inner) => `
  <g filter="url(#${id}-glow)">${inner}</g>`;

/**
 * The dark screen, or its scanlines; `bleed` fills the square for icons the
 * system crops.
 *
 * @param {string} id
 * @param {"screen" | "scan"} layer
 * @param {number} w
 * @param {boolean} bleed
 */
const screen = (id, layer, w, bleed) =>
  `<rect width="${w}" height="64" rx="${bleed ? 0 : 14}" fill="url(#${id}-${layer})"/>`;

/**
 * @param {number} w
 * @param {string} inner
 * @param {string} size Width and height attributes, if any.
 */
const svg = (w, inner, size = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 64"${size} role="img" aria-label="Ork">
  <title>Ork</title>${inner}
</svg>
`;

/**
 * The mark on its screen; `scale` shrinks it for icons' safe zones.
 *
 * @param {{ bleed?: boolean; scale?: number; size?: string }} options
 */
export const markOnScreen = ({ bleed = false, scale = 1, size = "" } = {}) =>
  svg(
    64,
    `${defs("ork")}
  ${screen("ork", "screen", 64, bleed)}${glow("ork", markPixels(scale))}
  ${screen("ork", "scan", 64, bleed)}`,
    size,
  );

/** The mark alone, for dark backgrounds. */
export const markTransparent = () =>
  svg(
    64,
    `${defs("ork")}${glow("ork", markPixels())}`,
    ' width="256" height="256"',
  );

/**
 * @param {readonly string[]} rows
 * @param {number} x0
 */
const glyphPath = (rows, x0) =>
  rows
    .flatMap((row, y) =>
      row
        .split("")
        .flatMap((ch, x) =>
          ch === "#"
            ? [`M${x0 + x * TYPE_CELL} ${15.6 + y * TYPE_CELL}h4.4v4.4h-4.4z`]
            : [],
        ),
    )
    .join("");

const WORD_W = 162;

/** The mark and the "ork" logotype on one screen. */
export const wordmark = () => {
  const id = "ork-word";
  const type = ["o", "r", "k"]
    .map(
      (ch, i) => `
    <path d="${glyphPath(GLYPH_ROWS[ch] ?? [], 64 + i * 6 * TYPE_CELL)}"/>`,
    )
    .join("");
  return svg(
    WORD_W,
    `${defs(id)}
  ${screen(id, "screen", WORD_W, false)}
  <g transform="translate(6 6) scale(${String(LOCKUP_SCALE)})">${glow(id, markPixels())}
  </g>
  <g filter="url(#${id}-glow)" fill="${C.green}">${type}
  </g>
  ${screen(id, "scan", WORD_W, false)}`,
    ` width="${String(WORD_W * 4)}" height="256"`,
  );
};

/**
 * The 16 px drawing as an SVG: whole pixels, no glow or scanlines (they only
 * blur at this size), on its own dark tile so it reads on light and dark tab
 * bars alike.
 */
export const favicon = () => {
  const rects = cells(FAVICON_ROWS)
    .map(
      ({ x, y, fill }) =>
        `<rect x="${String(x)}" y="${String(y)}" width="1" height="1" fill="${fill}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">
  <rect width="16" height="16" rx="3" fill="${C.screen}" shape-rendering="geometricPrecision"/>
  ${rects}
</svg>
`;
};
