/**
 * @file `lock` (RFC-016): the name of a lock a node holds while the run works,
 *   so one run at a time takes a shared resource such as a branch.
 */

import { z } from "zod";

/** A lock's name: one per node, never blank; may read `{{inputs.*}}`. */
export const LockNameSchema = z
  .string()
  .regex(/\S/u, "a lock needs a name")
  .describe(
    "The lock this node holds, e.g. `branch:{{inputs.branch}}`. Held from the first node that names it to the last, or the run's end; one run at a time holds it, the others wait. One name per node.",
  );
export type LockName = z.infer<typeof LockNameSchema>;

/** The nodes that run one thing may name a lock (RFC-016). */
export const lockFields = {
  lock: LockNameSchema.optional(),
};
