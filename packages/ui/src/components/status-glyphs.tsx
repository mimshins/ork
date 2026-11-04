/**
 * @file The status glyphs: small shapes on a 5×5 grid, drawn here and not taken
 *   from Material Design Icons (ADR-055), because none of its icons stay crisp
 *   this small. Each cell is a square in the current text color at the font's
 *   size, so 10 px gives whole 2 px cells. Each status has its own shape, so it
 *   reads without color and in red-green color blindness. They're decoration:
 *   the word beside one says what it means.
 */

const ROWS = 5;

/** A drawing as one string per row, with `#` for a filled cell, as a path. */
export const glyphPath = (rows: readonly string[]): string =>
  rows
    .flatMap((row, y) =>
      row
        .split("")
        .flatMap((cell, x) =>
          cell === "#" ? [`M${String(x)} ${String(y)}h1v1h-1z`] : [],
        ),
    )
    .join("");

const glyph = (rows: readonly string[]) => {
  const Glyph = () => (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      height="1em"
      shapeRendering="crispEdges"
      viewBox={`0 0 ${String(ROWS)} ${String(ROWS)}`}
      width="1em"
    >
      <path d={glyphPath(rows)} />
    </svg>
  );
  return Glyph;
};

export const GlyphRunning = glyph([
  ".....",
  ".###.",
  ".###.",
  ".###.",
  ".....",
]);
export const GlyphSucceeded = glyph([
  "....#",
  "...#.",
  "#.#..",
  ".#...",
  ".....",
]);
export const GlyphWaiting = glyph([
  "..#..",
  ".#.#.",
  "#...#",
  ".#.#.",
  "..#..",
]);
export const GlyphPaused = glyph([".#.#.", ".#.#.", ".#.#.", ".#.#.", ".#.#."]);
export const GlyphFailed = glyph(["#...#", ".#.#.", "..#..", ".#.#.", "#...#"]);
export const GlyphQueued = glyph(["#.#.#", ".....", "#...#", ".....", "#.#.#"]);
export const GlyphSkipped = glyph([
  ".....",
  ".....",
  "#####",
  ".....",
  ".....",
]);
export const GlyphInterrupted = glyph([
  "#####",
  "#...#",
  "#...#",
  "#...#",
  "#####",
]);
