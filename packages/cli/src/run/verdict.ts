/**
 * @file The one-line verdict of a finished node: its report's status, unless
 *   the node failed or its work did not merge.
 */

import { firstLine } from "./format-bus.ts";
import { itemsRan } from "./items-ran.ts";

/** Whether a finished node's work did not merge into its owner. */
export const hasConflict = (output: Record<string, unknown>): boolean => {
  const { merge } = output;
  return (
    typeof merge === "object" &&
    merge !== null &&
    "ok" in merge &&
    merge.ok === false
  );
};

/**
 * A one-line verdict for a finished node, by what its type outputs. A node that
 * failed reads `fail` even when its report said `pass` (a hook refused its
 * commit); a child that did not merge says so.
 */
export const nodeVerdict = (
  output: Record<string, unknown>,
  ok = true,
  error?: string,
): string => {
  const { status, summary, exitCode, choice, answeredBy, count } = output;
  if (typeof status === "string") {
    if (!ok && (status === "pass" || status === "done")) {
      return error === undefined ? "fail" : `fail: ${firstLine(error)}`;
    }
    const label = hasConflict(output) ? `${status}, merge conflict` : status;
    return typeof summary === "string" && summary !== ""
      ? `${label}: ${summary}`
      : label;
  }
  if (typeof exitCode === "number") return `exit ${String(exitCode)}`;
  if (typeof choice === "string") return `${choice} (${String(answeredBy)})`;
  if (typeof count === "number") return itemsRan(count, output["statuses"]);
  return "done";
};
