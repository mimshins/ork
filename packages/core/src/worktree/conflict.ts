/**
 * @file The result of a child whose work did not merge into its owner: the same
 *   result, with `merge: { ok: false, … }` in its output.
 */

import type { NodeResult } from "../run/types.ts";

export const withConflict = (
  result: NodeResult,
  conflicts: readonly string[],
  into: string,
): NodeResult => ({
  ...result,
  output: { ...result.output, merge: { ok: false, conflicts, into } },
});
