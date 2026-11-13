/**
 * @file Tests the usage `kit.ts` prints for an unknown or missing subcommand:
 *   it carries the note that a wrapper around a stand-in must stream stdin
 *   through, since Ork's driver keeps stdin open until the first result.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const KIT = fileURLToPath(new URL("../kit.ts", import.meta.url));

describe("kit.ts usage", () => {
  it("tells a wrapper to stream stdin through", () => {
    const done = spawnSync(process.execPath, [KIT], { encoding: "utf8" });
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("Usage: kit.ts setup");
    expect(done.stderr).toContain("must stream stdin through");
  });
});
