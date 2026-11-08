/**
 * @file What a node with `forEach` says (RFC-013): the fields it gathers from
 *   its items, which replace its type's own for conditions and the builder.
 *   `statuses` holds what its items' type can report, and `skipped`.
 */

import type { NodeSays } from "./says.ts";

/** The statuses a fan-out gives, whatever its items report. */
const ALWAYS = ["pass", "fail", "skipped"];

/** What a fanned node gathers, from what one of its items says. */
export const gatheredSays = (item: NodeSays): NodeSays => {
  const status = item.fields.find(({ field }) => field === "status");
  return {
    fields: [
      // Lists with no item shape of their own, as `{ list: {} }` declares.
      { field: "items", kind: "text", items: [] },
      { field: "results", kind: "text", items: [] },
      {
        field: "statuses",
        kind: "statuses",
        values: [...new Set([...ALWAYS, ...(status?.values ?? [])])],
        ...(status?.open === true ? { open: true } : {}),
      },
      { field: "count", kind: "number" },
    ],
    // The node fails when an item does, which an edge can handle.
    canFail: true,
    canDeclare: false,
  };
};
