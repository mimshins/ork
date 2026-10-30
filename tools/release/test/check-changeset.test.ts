/** @file Tests for the rule that decides whether a change needs a changeset. */

import { describe, expect, it } from "vitest";

import { needsChangeset } from "../check-changeset.ts";

describe("needsChangeset", () => {
  it.each([
    [["packages/core/src/graph/flow.ts"], true],
    [["packages/cli/package.json"], true],
    [["packages/core/src/x.ts", ".changeset/brave-owls.md"], false],
    [["packages/core/test/compile.test.ts"], false],
    [["docs/design.md", "README.md"], false],
    [["packages/core/src/x.ts", ".changeset/README.md"], true],
  ])("%j -> %s", (changed, expected) => {
    expect(needsChangeset(changed)).toBe(expected);
  });
});
