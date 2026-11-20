/**
 * @file What the write-limit tests share: a checkout with an `.ork/` folder and
 *   a link in it that leads out of it, and a session spec limited to `.ork/`.
 */

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SessionSpec } from "@krapht/ork-core";

/** The folders the sessions under test may write under. */
export const LIMIT = [".ork/"];

/** What a refusal under {@link LIMIT} says. */
export const LIMITED = "writes only under `.ork/`";

export const tmp = (name: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), `ork-limit-${name}-`)));

/** A checkout with `.ork/` and a link, `.ork/out`, that leads to `src/`. */
export const checkout = (): string => {
  const cwd = tmp("cwd");
  mkdirSync(path.join(cwd, ".ork"));
  mkdirSync(path.join(cwd, "src"));
  symlinkSync(path.join(cwd, "src"), path.join(cwd, ".ork", "out"));
  return cwd;
};

/** A session in `cwd` that may edit, limited to {@link LIMIT}. */
export const limitedSpec = (
  cwd: string,
  over: Partial<SessionSpec> = {},
): SessionSpec => ({
  nodeId: "worker",
  cwd,
  prompt: "Apply the feedback",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: ["Edit", "Write"], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
  reading: "open",
  writeOnly: LIMIT,
  ...over,
});
