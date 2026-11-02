/**
 * @file Keeps what did not change. Every stream frame is freshly parsed, so
 *   each record in it is a new object even when nothing in it is new; a panel
 *   selecting one run would then re-render for a change to another. So a record
 *   equal to the one held keeps the old object, and a list with nothing new
 *   keeps the old list, which a container takes as no change at all.
 */

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export const reconcile = <T extends { id: string }>(
  held: readonly T[] | null,
  next: readonly T[],
): readonly T[] => {
  if (held === null) return next;
  const known = new Map(held.map(record => [record.id, record]));
  const merged = next.map(record => {
    const old = known.get(record.id);
    return old !== undefined && same(old, record) ? old : record;
  });
  return merged.length === held.length &&
    merged.every((record, index) => record === held[index])
    ? held
    : merged;
};
