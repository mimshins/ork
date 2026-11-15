/**
 * @file Pins the tab-completion scripts by hash. A user who saved the script to
 *   a file (zsh's `_ork`, fish's `ork.fish`, bash 3.2's sourced file) keeps the
 *   old one until they run `ork completion <shell>` again; new commands, flags
 *   and values need no new script, as it asks `ork __complete` for them. So a
 *   change to a script has to tell them, and this test fails until it does.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SHELL_SCRIPTS } from "../src/completion/scripts.ts";

/**
 * The scripts as last released. When one changes: add an "Upgrade: run `ork
 * completion <shell>` again, if you saved it to a file" line to
 * docs/whats-new/next-release.md, then set its new hash here.
 */
const PINNED = {
  zsh: "0aa06a53582617e2",
  bash: "376b45163690e3ae",
  fish: "0ccb2afbbae48ad3",
};

const hashes = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(SHELL_SCRIPTS).map(([shell, script]) => [
      shell,
      createHash("sha256").update(script).digest("hex").slice(0, 16),
    ]),
  );

describe("the completion scripts", () => {
  it("are unchanged, or Next release says to save them again", () => {
    expect(
      hashes(),
      "A completion script changed. Users who saved it to a file keep the old one: add an Upgrade line to docs/whats-new/next-release.md saying to run `ork completion <shell>` again, then update PINNED in this test.",
    ).toEqual(PINNED);
  });
});
