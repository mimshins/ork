/**
 * @file How often a person must allow a shell rule before Ork proposes it for
 *   the project's `permissions.allow` (`permission.suggest`, RFC-028 part 4).
 *   Unmeasured first values, to tune from real counts.
 */

/** Allows of the rule, across the project's runs. */
export const SUGGEST_MIN_ALLOWS = 3;

/** Distinct runs those allows came from. */
export const SUGGEST_MIN_RUNS = 2;
