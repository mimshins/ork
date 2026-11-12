/**
 * @file Which limits across runs apply where (RFC-007): the user's settings and
 *   a project's rules, read fresh each time, as a run may last for hours and
 *   the user may raise one while it does.
 */

import { placeFiles, type ProjectPlace } from "../project/place.ts";
import { loadProject, loadUserSettings } from "../project/rules.ts";
import { type AnyCap, capsOf } from "./quota.ts";

/** The caps that apply in `place`, or only the user's without one. */
export const capsHere = (
  home: string | undefined,
  place?: ProjectPlace,
): { problems: string[]; caps: AnyCap[] } => {
  const user = loadUserSettings(home);
  try {
    const rules =
      place === undefined
        ? undefined
        : loadProject(place.root, placeFiles(place).rules);
    return {
      problems: [...user.diagnostics, ...(rules?.diagnostics ?? [])].map(
        found => found.message,
      ),
      caps: capsOf(user.settings?.quotas, rules?.project?.quotas, place?.root),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      problems: [`.ork/project.yaml can't be read: ${reason}`],
      caps: capsOf(user.settings?.quotas),
    };
  }
};
