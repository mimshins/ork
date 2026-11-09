/**
 * @file `ork doctor`'s line for Ork itself (ADR-038): the running version
 *   against the last update check, read from the record without asking the
 *   network. What `ork upgrade` does is core's (`planUpgrade`, `runInstall`),
 *   shared with the server behind `ork ui`.
 */

import { newerVersion, type UpdateCache } from "@krapht/ork-core";
import type { CheckResult } from "@krapht/ork-integrations";

/** `ork doctor`'s line for Ork itself, from the last check. */
export const versionCheck = (
  current: string,
  cache: UpdateCache | null,
  /** Why the daily check is off for this command (`updateCheckOff`), or null. */
  checksOff: string | null,
): CheckResult => {
  const newer = newerVersion(cache, current);
  if (newer !== null) {
    return {
      name: "ork",
      status: "warn",
      detail: `${current}; ${newer} is out`,
      hint: "Run ork upgrade.",
    };
  }
  const known =
    cache?.latest === undefined
      ? checksOff === null
        ? "not checked for updates yet"
        : `the daily update check is off here: ${checksOff}`
      : `the latest as of ${cache.checkedAt.slice(0, 10)}`;
  return { name: "ork", status: "ok", detail: `${current} (${known})` };
};
