/**
 * @file Runs a check once per set of files, for `ork once` and for
 *   `verify:`/tool commands with `once: true`: skip it when the same check
 *   already passed on identical files, else run it and record a pass when it
 *   exits 0 and the files didn't change while it ran. `force` and
 *   `ORK_ONCE=off` run it anyway; outside a git repository it always runs.
 */

import { filesOf, OncePathspecError, treeKeyOf, type TreeKey } from "./key.ts";
import { findPass, type OncePass, recordPass } from "./store.ts";

export type RunOnceOptions = {
  cwd: string;
  /** The check's name (`--as`, default the command's text). */
  name: string;
  covers?: readonly string[];
  withHead?: boolean;
  /**
   * Git pathspecs (relative to `cwd`) the check depends on: only the files they
   * match key it. Empty or absent: the whole tree. Rejects with
   * `OncePathspecError`, before `run`, when git rejects them.
   */
  on?: readonly string[];
  /** Run even after a pass, and record a new one. */
  force?: boolean;
  /** `<run>/<node>` for Ork, `you` from a terminal. Default `you`. */
  who?: string;
  /** Runs the check; resolves to its exit code. */
  run: () => Promise<number>;
  /** Default `process.env`; `ORK_ONCE=off` turns the cache off. */
  env?: NodeJS.ProcessEnv;
  /** Default `process.version`. */
  node?: string;
};

export type RunOnceResult =
  /** An earlier pass on these files; the check didn't run. */
  | { skipped: true; pass: OncePass; code: 0 }
  /** The check ran; `pass` is the one recorded, if any. */
  | { skipped: false; pass?: OncePass; code: number };

/**
 * `null` outside a git repository: nothing to key the files by. Rejected
 * pathspecs reject, so a bad `--on` is an error, never a run without a key.
 */
const keyOf = (cwd: string, on: readonly string[]): Promise<TreeKey | null> =>
  treeKeyOf(cwd, { on }).catch((error: unknown) => {
    if (error instanceof OncePathspecError) throw error;
    return null;
  });

/** Runs `run` unless the check already passed on these files. */
export const runOnce = async ({
  cwd,
  name,
  covers = [],
  withHead = false,
  on = [],
  force = false,
  who = "you",
  run,
  env = process.env,
  node = process.version,
}: RunOnceOptions): Promise<RunOnceResult> => {
  if (env["ORK_ONCE"] === "off") return { skipped: false, code: await run() };
  const before = await keyOf(cwd, on);
  const earlier =
    before === null || force
      ? null
      : findPass({ key: before, name, withHead, node });
  if (earlier !== null) return { skipped: true, pass: earlier, code: 0 };
  const code = await run();
  if (code !== 0 || before === null) return { skipped: false, code };
  // A pass counts only for the files it ran on: an edit during the run records nothing.
  // The check ran: a key that fails now records nothing, it never hides `code`.
  const after = await keyOf(cwd, on).catch(() => null);
  if (
    after === null ||
    filesOf(after) !== filesOf(before) ||
    after.head !== before.head
  ) {
    return { skipped: false, code };
  }
  const pass = recordPass({ key: before, name, covers, who, node });
  return { skipped: false, pass, code };
};
