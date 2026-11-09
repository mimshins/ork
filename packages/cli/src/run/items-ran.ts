/**
 * @file How a fan-out's finished line counts its items: only the ones that
 *   started.
 */

/** How many of a fan-out's items started; a skipped one never did. */
export const itemsRan = (count: number, statuses: unknown): string => {
  const ran = Array.isArray(statuses)
    ? statuses.filter(status => status !== "skipped").length
    : count;
  return ran === count
    ? `${String(count)} ran`
    : `${String(ran)} of ${String(count)} ran`;
};
