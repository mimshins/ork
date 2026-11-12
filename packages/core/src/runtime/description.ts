/**
 * @file A delegated task's `description`: a few words a leader gives to name
 *   the task, shown beside the child's id. Ork clips it once on accept.
 */

/** The most characters of a task's `description` that Ork keeps. */
export const DESCRIPTION_MAX = 80;

/** A task's few words naming it, the child's label. */
export type Described = { description?: string };
