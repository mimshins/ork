/**
 * @file `forEach` (RFC-013): run a node once per item of a list, written in the
 *   file or reported by an earlier node.
 */

import { z } from "zod";

const pacingFields = {
  maxParallel: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Most items running at once. Default: limits.concurrency."),
  onFailure: z
    .enum(["finish", "stop"])
    .optional()
    .describe(
      "When an item fails: `finish` runs every item (default), `stop` starts no more.",
    ),
};

/**
 * Run a node once per item of a list (RFC-013): a fixed list or an earlier
 * node's.
 */
export const ForEachSchema = z.union([
  z.strictObject({
    items: z
      .array(z.unknown())
      .min(1)
      .describe("The list, written here. Each entry is one item."),
    ...pacingFields,
  }),
  z.strictObject({
    from: z
      .string()
      .describe(
        "Where the list comes from: one path, e.g. {{nodes.plan.output.tasks}}.",
      ),
    maxItems: z
      .number()
      .int()
      .positive()
      .describe(
        "Most items allowed. A longer list asks whether to stop, run this many, or run all.",
      ),
    ...pacingFields,
  }),
]);
export type ForEach = z.infer<typeof ForEachSchema>;

/** The nodes that run one thing may run it once per item (RFC-013). */
export const forEachFields = {
  forEach: ForEachSchema.optional().describe(
    "Run this node once per item of a list, with no model turn to fan out or gather. Items are `<id>.0`, `<id>.1`, ….",
  ),
};
