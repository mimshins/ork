/**
 * @file What stops `ork onboard` before it writes or spends anything: a flag
 *   pair, no terminal, an attached project, a repository with no commit, and
 *   `ork doctor`'s required checks for Node and git
 *   (specs/cli/onboard-flow.md#refusals). Each is lines to print and exit 1.
 */

import { placeFor, type ProjectPlace } from "@krapht/ork-core";
import type { Exec } from "@krapht/ork-integrations";

import { checkGit, checkNode, headWarning } from "../doctor/checks.ts";

export type RefusalInput = {
  cwd: string;
  /** Whether stdin and stderr are a terminal. */
  interactive: boolean;
  review: boolean;
  fresh: boolean;
  exec: Exec;
  nodeVersion: string;
  registered: readonly ProjectPlace[];
};

/** Why `ork onboard` stops here, as lines; `null` when it can go on. */
export const refusal = async (o: RefusalInput): Promise<string[] | null> => {
  if (o.review && o.fresh) {
    return ["--review and --fresh can't be used together."];
  }
  if (!o.interactive) {
    return ["ork onboard asks questions: run it in a terminal."];
  }
  const place = placeFor(o.cwd, o.registered);
  if (place.mode === "attached") {
    return [
      `${place.root} is attached, and ork onboard writes into a repository: run \`ork init\` in the repository, then \`ork onboard\` there.`,
    ];
  }
  const noCommit = await headWarning(o.exec);
  if (noCommit !== null) return [`git: ${noCommit}`];
  const failed = [checkNode(o.nodeVersion), ...(await checkGit(o.exec))].filter(
    check => check.status !== "ok",
  );
  if (failed.length === 0) return null;
  return failed.map(
    ({ name, detail, hint }) =>
      `${name}: ${detail}${hint === undefined ? "" : `. ${hint}`}`,
  );
};
