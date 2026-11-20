/**
 * @file The text half of renumbering an RFC: its number in its own text and its
 *   row in the index table of `rfcs/README.md`, padded to the table's column
 *   widths as `close.ts` keeps them.
 */

/** Three digits at least, as RFC numbers are written. */
export const pad = (n: number): string => String(n).padStart(3, "0");

/** `text` with `RFC-<from>` (not `RFC-<from>0`) written as `RFC-<to>`. */
export const renumberText = (text: string, from: number, to: number): string =>
  text.replaceAll(
    new RegExp(`RFC-${pad(from)}(?!\\d)`, "gu"),
    `RFC-${pad(to)}`,
  );

const isRule = (cell: string): boolean => /^-+$/u.test(cell);

/** The cells of a table row, trimmed. */
const cellsOf = (line: string): string[] =>
  line
    .split(/(?<!\\)\|/u)
    .slice(1, -1)
    .map(cell => cell.trim());

/** The table around line `at`, every column padded to its widest cell. */
const padTable = (lines: string[], at: number): void => {
  let first = at;
  let last = at;
  while ((lines[first - 1] ?? "").startsWith("|")) {
    first -= 1;
  }
  while ((lines[last + 1] ?? "").startsWith("|")) {
    last += 1;
  }
  const rows = lines.slice(first, last + 1).map(line => cellsOf(line));
  const widths: number[] = [];
  for (const cells of rows) {
    cells.forEach((cell, col) => {
      widths[col] = Math.max(widths[col] ?? 3, isRule(cell) ? 3 : cell.length);
    });
  }
  rows.forEach((cells, i) => {
    const cut = cells.map((cell, col) =>
      isRule(cell)
        ? "-".repeat(widths[col] ?? 3)
        : cell.padEnd(widths[col] ?? 0),
    );
    lines[first + i] = `| ${cut.join(" | ")} |`;
  });
};

/**
 * The index with the row of RFC `from` (`ourRow`, from our own index, linking
 * `oldFile`) written as RFC `to`: replacing the row that links `oldFile` or,
 * when there is none, added after the last RFC row; the table is padded to its
 * widest cell. Throws when the index has nowhere to put it.
 */
export const renumberIndex = (
  index: string,
  ourRow: string,
  from: number,
  to: number,
  oldFile: string,
): string => {
  const row = renumberText(
    ourRow.replace(`[${pad(from)}]`, `[${pad(to)}]`),
    from,
    to,
  );
  const lines = index.split("\n");
  const own = lines.findIndex(line => line.includes(`(./active/${oldFile})`));
  const last = lines.findLastIndex(line => /^\|\s*\[\d+\]\(\.\//u.test(line));
  if (own === -1 && last === -1) {
    throw new Error("rfcs/README.md has no RFC table to add a row to.");
  }
  const at = own === -1 ? last + 1 : own;
  lines.splice(at, own === -1 ? 0 : 1, row);
  padTable(lines, at);
  return lines.join("\n");
};
