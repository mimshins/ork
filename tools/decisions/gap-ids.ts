/**
 * @file The gap-id half of renumbering what a change adds (`renumber.ts`): the
 *   gap, limit and chore ids (`G…`, `L…`, `C…`) a change defines in the gaps
 *   register that are already used, the ids they move to, a line after the
 *   move, and the register's "next id" line.
 */

/** An entry's opening, `- **L123 · Title.**`, as `pnpm docs:check` reads it. */
const GAP_ENTRY = /^- \*\*([GLC])(\d+) ·/u;

/** The same opening as an extended regex, for `git grep -E`. */
export const GAP_ENTRY_PATTERN = "^- \\*\\*[GLC][0-9]+ ·";

/** The register's "the next limit is L524" phrases. */
const NEXT_ID = /\b(next (?:limit|gap|chore)(?: id)? is )([GLC])(\d+)(?!\d)/gu;

/** One entry: its id, letter and number, and its opening line. */
export type GapDef = {
  readonly id: string;
  readonly letter: string;
  readonly number: number;
  readonly line: string;
};

/** The ids one ref defines (id to opening lines) and its "next id" values. */
export type GapsOn = {
  readonly ref: string;
  readonly defs: ReadonlyMap<string, readonly string[]>;
  readonly next: ReadonlyMap<string, number>;
};

/** One added entry and the id it moves to. */
export type GapMove = GapDef & { readonly to: string; readonly reason: string };

/** The entries among `lines`, in order. */
export const definitionsOf = (lines: readonly string[]): GapDef[] =>
  lines.flatMap(line => {
    const match = GAP_ENTRY.exec(line);
    const letter = match?.[1];
    const number = match?.[2];
    return letter === undefined || number === undefined
      ? []
      : [{ id: `${letter}${number}`, letter, number: Number(number), line }];
  });

/** Id to opening lines of every entry among `defs`. */
export const byId = (defs: readonly GapDef[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const def of defs) {
    map.set(def.id, [...(map.get(def.id) ?? []), def.line]);
  }
  return map;
};

/** Letter to number of the register's "next id" phrases in `text`. */
export const nextIdsOf = (text: string): Map<string, number> =>
  new Map(
    [...text.matchAll(NEXT_ID)].map(match => [
      match[2] ?? "",
      Number(match[3] ?? 0),
    ]),
  );

/** `text` with each letter's "next id" raised to at least `wanted`'s. */
export const bumpNextIds = (
  text: string,
  wanted: ReadonlyMap<string, number>,
): string =>
  text.replaceAll(
    NEXT_ID,
    (_whole, phrase: string, letter: string, number: string) =>
      `${phrase}${letter}${String(Math.max(Number(number), wanted.get(letter) ?? 0))}`,
  );

/** Where `def` is already used, or undefined when it is free. */
const clashOf = (
  def: GapDef,
  earlier: readonly GapDef[],
  refs: readonly GapsOn[],
  kept: ReadonlyMap<string, readonly string[]>,
): string | undefined =>
  refs.find(({ defs, next }) => {
    const lines = defs.get(def.id);
    return lines === undefined
      ? (next.get(def.letter) ?? 0) > def.number
      : lines.some(line => line !== def.line);
  })?.ref ??
  ((kept.get(def.id) ?? []).length > 0 || earlier.some(d => d.id === def.id)
    ? "this change"
    : undefined);

/**
 * The added entries that move, letter by letter in number order. An id is used
 * when a ref defines it with another entry, a ref's "next id" is past it, or an
 * entry the change keeps or an earlier added one has it. From the first used
 * one, every added entry of that letter takes the next id above all of them.
 */
export const planGapIds = (
  added: readonly GapDef[],
  refs: readonly GapsOn[],
  kept: readonly GapDef[],
): GapMove[] => {
  const keptIds = byId(kept);
  const letters = [...new Set(added.map(def => def.letter))].toSorted();
  return letters.flatMap(letter => {
    const sorted = added
      .filter(def => def.letter === letter)
      .toSorted((a, b) => a.number - b.number);
    const where = sorted.map((def, i) =>
      clashOf(def, sorted.slice(0, i), refs, keptIds),
    );
    const first = where.findIndex(ref => ref !== undefined);
    if (first === -1) {
      return [];
    }
    const numbers = [
      ...refs.flatMap(({ defs }) => definitionsOf([...defs.values()].flat())),
      ...kept,
    ]
      .filter(def => def.letter === letter)
      .map(def => def.number);
    let next =
      Math.max(
        0,
        ...numbers,
        ...refs.map(({ next: ids }) => (ids.get(letter) ?? 0) - 1),
        ...sorted.slice(0, first).map(def => def.number),
      ) + 1;
    const from = sorted[first]?.id ?? "";
    return sorted.slice(first).map((def, i) => ({
      id: def.id,
      letter: def.letter,
      number: def.number,
      line: def.line,
      to: `${letter}${String(next++)}`,
      reason:
        i === 0
          ? `${def.id} is taken on ${where[first] ?? ""}`
          : `it follows ${from}, which moved`,
    }));
  });
};

/**
 * `line` with the moved ids written as their new ones: the id that opens a
 * moved entry, and any other id only where `bare` gives the id it becomes.
 */
export const renumberGapLine = (
  line: string,
  moves: readonly GapMove[],
  bare: (id: string) => string | undefined,
): string => {
  if (moves.length === 0) {
    return line;
  }
  const own = moves.find(move => move.line === line);
  return line.replaceAll(/(?<![\w-])[GLC]\d+(?!\d)/gu, (id, offset: number) =>
    own !== undefined && offset === 4 ? own.to : (bare(id) ?? id),
  );
};
