/** @file Tests for the check that a changeset names only published packages. */

import { describe, expect, it } from "vitest";

import { namesIn, unpublishedIn } from "../changeset-names.ts";

const MIXED = `---
"@krapht/ork-core": patch
"@krapht/ork": patch
---

Something changed.
`;

describe("namesIn", () => {
  it("reads the package names from the front matter only", () => {
    expect(namesIn(MIXED)).toEqual(["@krapht/ork-core", "@krapht/ork"]);
    expect(namesIn("---\n---\n\nempty: none")).toEqual([]);
  });
});

describe("unpublishedIn", () => {
  it("names a changeset that bumps a private package", () => {
    expect(
      unpublishedIn(
        [
          { file: "mixed.md", text: MIXED },
          { file: "fine.md", text: '---\n"@krapht/ork": patch\n---\n' },
        ],
        new Set(["@krapht/ork"]),
      ),
    ).toEqual([{ file: "mixed.md", names: ["@krapht/ork-core"] }]);
  });
});
