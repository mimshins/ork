/**
 * @file Runs the real `npm audit` through `realAudit` on a project with no
 *   dependencies, so the scanner's spawn is proven on the platform it runs on:
 *   Windows runs npm's `.cmd` shim only through a shell. It needs npm and the
 *   registry, so it runs only with `ORK_AUDIT_SPAWN=1`, which CI's Windows job
 *   sets.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseNpmAudit } from "../advisories.ts";
import { realAudit } from "../scan.ts";

const PROJECT = { name: "spawn-check", version: "1.0.0" };

describe.runIf(process.env["ORK_AUDIT_SPAWN"] === "1")("realAudit", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs npm audit and reads its JSON, with no note that it could not run", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ork-audit-spawn-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(PROJECT));
    writeFileSync(
      path.join(dir, "package-lock.json"),
      JSON.stringify({
        ...PROJECT,
        lockfileVersion: 3,
        requires: true,
        packages: { "": PROJECT },
      }),
    );
    expect(parseNpmAudit(realAudit(dir, "npm"))).toEqual({
      records: [],
      notes: [],
    });
  });
});
