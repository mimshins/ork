/**
 * @file Tests that a workflow printed in a user guide runs as printed: the
 *   "Many runs onto one branch" block of the parallel-issues guide validates
 *   with no diagnostics and orders its nodes `fetch → check → push`.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkWorkflowText, inRepoPlace } from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

const GUIDE = path.resolve(
  import.meta.dirname,
  "../../../docs/guides/issues-in-parallel/locks-and-conflicts.md",
);

/** The first yaml block under a heading of the guide. */
const blockUnder = (heading: string): string => {
  const text = readFileSync(GUIDE, "utf8");
  const after = text.slice(text.indexOf(`## ${heading}`));
  const match = /```yaml\n([\s\S]*?)```/u.exec(after);
  return match?.[1] ?? "";
};

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe("the guide's own workflow", () => {
  it("validates as printed and runs fetch, check, push in order", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ork-guide-"));
    folders.push(root);
    const checks = checkWorkflowText(blockUnder("Many runs onto one branch"), {
      place: inRepoPlace(root),
      workflowDir: root,
      registered: [],
      home: root,
    });

    expect(checks.diagnostics).toEqual([]);
    expect(checks.graph?.edges.map(edge => `${edge.from}→${edge.to}`)).toEqual([
      "fetch→check",
      "check→push",
    ]);
  });
});
