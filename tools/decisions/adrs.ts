/**
 * @file The ADR half of renumbering what a change adds (`renumber.ts`): which
 *   added ADRs take a number that is already used and the numbers they move to,
 *   and the text of a line or of `decisions/README.md` after the move.
 */

import { pad, padTable } from "../rfcs/index-table.ts";

/** An ADR file: its name, then its number. */
const ADR_FILE = /^decisions\/(ADR-(\d+)-[^/]+\.md)$/u;

/** An ADR file the change adds. */
export type AddedAdr = {
  readonly path: string;
  readonly file: string;
  readonly number: number;
};

/** The ADR files of one ref, by number (a number may have several files). */
export type AdrsOn = {
  readonly ref: string;
  readonly taken: ReadonlyMap<number, readonly string[]>;
};

/** One added ADR and the number it moves to. */
export type AdrMove = AddedAdr & {
  readonly to: number;
  readonly newFile: string;
  readonly newPath: string;
  readonly reason: string;
};

/** The ADR among `name` (a path in a git tree), or undefined. */
export const adrOf = (name: string): AddedAdr | undefined => {
  const match = ADR_FILE.exec(name);
  const file = match?.[1];
  const number = match?.[2];
  return file === undefined || number === undefined
    ? undefined
    : { path: name, file, number: Number(number) };
};

/** Number to file names of every ADR among `names` (paths in a git tree). */
export const takenAdrs = (names: readonly string[]): Map<number, string[]> => {
  const taken = new Map<number, string[]>();
  for (const name of names) {
    const adr = adrOf(name);
    if (adr !== undefined) {
      taken.set(adr.number, [...(taken.get(adr.number) ?? []), adr.file]);
    }
  }
  return taken;
};

const otherThan = (
  taken: ReadonlyMap<number, readonly string[]>,
  adr: AddedAdr,
): boolean => (taken.get(adr.number) ?? []).some(file => file !== adr.file);

/**
 * The added ADRs that move, in number order. From the first one whose number a
 * ref, an ADR the change keeps, or an earlier added ADR already holds, every
 * added ADR takes the next number above all of them, so they stay in order.
 */
export const planAdrs = (
  added: readonly AddedAdr[],
  refs: readonly AdrsOn[],
  kept: ReadonlyMap<number, readonly string[]>,
): AdrMove[] => {
  const sorted = added.toSorted(
    (a, b) => a.number - b.number || a.file.localeCompare(b.file),
  );
  const clashOf = (adr: AddedAdr, i: number): string | undefined =>
    refs.find(({ taken }) => otherThan(taken, adr))?.ref ??
    (otherThan(kept, adr) ||
    sorted.slice(0, i).some(a => a.number === adr.number)
      ? "this change"
      : undefined);
  const first = sorted.findIndex((adr, i) => clashOf(adr, i) !== undefined);
  if (first === -1) {
    return [];
  }
  const firstAdr = sorted[first];
  const where = firstAdr === undefined ? "" : (clashOf(firstAdr, first) ?? "");
  let next =
    Math.max(
      0,
      ...refs.flatMap(({ taken }) => [...taken.keys()]),
      ...kept.keys(),
      ...sorted.slice(0, first).map(adr => adr.number),
    ) + 1;
  return sorted.slice(first).map((adr, i) => {
    const to = next++;
    const newFile = adr.file.replace(
      `ADR-${pad(adr.number)}-`,
      `ADR-${pad(to)}-`,
    );
    return {
      path: adr.path,
      file: adr.file,
      number: adr.number,
      to,
      newFile,
      newPath: `decisions/${newFile}`,
      reason:
        i === 0
          ? `ADR-${pad(adr.number)} is taken on ${where}`
          : `it follows ADR-${pad(firstAdr?.number ?? 0)}, which moved`,
    };
  });
};

/** The move whose old file a link target points at, if any. */
const moveOfTarget = (
  target: string,
  moves: readonly AdrMove[],
): AdrMove | undefined => {
  const file = (target.split("#")[0] ?? "").split("/").at(-1);
  return moves.find(move => move.file === file);
};

const retarget = (target: string, move: AdrMove): string =>
  target.replace(move.file, move.newFile);

/**
 * `line` with the moved ADRs written under their new numbers: links to a moved
 * file (and the `[ADR-NNN]` or index `[NNN]` label on them), and a bare
 * `ADR-NNN` (or, in the index, `by NNN`) only where `bare` gives the number it
 * stands for here. Any other ADR, and any other number, is left alone.
 */
/** Each number of an index row's `by NNN, NNN` list, moved by `to`. */
const byList = (
  list: string,
  to: (digits: string) => number | undefined,
): string =>
  list
    .split(", ")
    .map(digits => {
      const moved = to(digits);
      return moved === undefined ? digits : pad(moved);
    })
    .join(", ");

export const renumberAdrLine = (
  line: string,
  moves: readonly AdrMove[],
  bare: (from: number) => number | undefined,
  index = false,
): string => {
  if (moves.length === 0) {
    return line;
  }
  // `ADR-0107` is not `ADR-107`: only a number written as ADRs are moves.
  const bareOf = (digits: string): number | undefined =>
    digits === pad(Number(digits)) ? bare(Number(digits)) : undefined;
  const mention = (text: string): string =>
    text.replaceAll(
      /ADR-(\d+)(?!\d)((?:-[a-z0-9]+)*\.md)?/gu,
      (whole, digits: string, slug: string | undefined) => {
        const move = moves.find(m => m.file === `ADR-${digits}${slug ?? ""}`);
        const to = slug === undefined ? bareOf(digits) : move?.to;
        return slug === undefined
          ? to === undefined
            ? whole
            : `ADR-${pad(to)}`
          : (move?.newFile ?? whole);
      },
    );
  const label = (prefix: string, digits: string, target: string): string => {
    const move = moveOfTarget(target, moves);
    const whole = `[${prefix}${digits}](${target})`;
    // A link to an ADR that does not move keeps its label: it names that file.
    const keep = /ADR-\d+-/u.test(target)
      ? whole
      : `[${mention(`${prefix}${digits}`)}](${target})`;
    return move === undefined
      ? keep
      : `[${prefix}${Number(digits) === move.number ? pad(move.to) : digits}](${retarget(target, move)})`;
  };
  return line.replaceAll(
    /\[ADR-(\d+)\]\(([^)\s]*)\)|\[(\d+)\]\(\.\/(ADR-[^)\s]*)\)|ADR-\d+(?!\d)(?:(?:-[a-z0-9]+)*\.md)?|\bby (\d+(?:, \d+)*)(?!\d)/gu,
    (
      whole,
      adrLabel: string | undefined,
      adrTarget: string | undefined,
      rowLabel: string | undefined,
      rowTarget: string | undefined,
      by: string | undefined,
    ) => {
      // `by NNN` (or `by NNN, NNN`) is an ADR only in the index's Status column.
      return adrLabel !== undefined && adrTarget !== undefined
        ? label("ADR-", adrLabel, adrTarget)
        : rowLabel !== undefined && rowTarget !== undefined
          ? label("", rowLabel, `./${rowTarget}`)
          : by === undefined
            ? mention(whole)
            : `by ${index ? byList(by, bareOf) : by}`;
    },
  );
};

/** A row of the ADR table in `decisions/README.md`: its number. */
const ADR_ROW = /^\|\s*\[(\d+)\]\(\.\/ADR-/u;

/**
 * The index with its ADR rows in number order (a row keeps its place among rows
 * of the same number) and the table padded to its widest cell.
 */
export const orderAdrRows = (index: string): string => {
  const lines = index.split("\n");
  const at = lines.flatMap((line, i) => (ADR_ROW.test(line) ? [i] : []));
  const rows = at
    .map(i => lines[i] ?? "")
    .toSorted(
      (a, b) =>
        Number(ADR_ROW.exec(a)?.[1] ?? 0) - Number(ADR_ROW.exec(b)?.[1] ?? 0),
    );
  at.forEach((i, k) => {
    lines[i] = rows[k] ?? "";
  });
  const first = at[0];
  if (first !== undefined) {
    padTable(lines, first);
  }
  return lines.join("\n");
};
