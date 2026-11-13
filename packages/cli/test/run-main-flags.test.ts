/**
 * @file `ork ps --bogus` through the real `bin.ts` and citty's own `runMain`:
 *   one stderr line, `Unknown flag `--bogus`.`, exit 1. The in-process tests
 *   call `runCommand`, so only this one fails when a citty upgrade changes how
 *   `runMain` reports the argument error `refuseUnknownFlags` raises.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import { expect, it } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

it("refuses an unknown flag with one line and exit 1", () => {
  const home = mkdtempSync(path.join(tmpdir(), "ork-main-flags-"));
  const ran = spawnSync(process.execPath, [BIN, "ps", "--bogus"], {
    cwd: home,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      ORK_PLAIN: "1",
      ORK_NO_UPDATE_CHECK: "1",
    },
  });
  expect(stripVTControlCharacters(ran.stderr).trimEnd().split("\n")).toEqual([
    "Unknown flag `--bogus`.",
  ]);
  expect(ran.stdout).toBe("");
  expect(ran.status).toBe(1);
});
