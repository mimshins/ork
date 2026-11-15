/**
 * @file Tests that cutting What's new at a release moves Next release's notes
 *   to the version's page, lists it in the hub, and empties Next release.
 */

import { describe, expect, it } from "vitest";

import { cutRelease, EMPTY_NEXT } from "../whats-new.ts";

const HUB = `# What's new

## Contents

- [Next release](./whats-new/next-release.md)
- [1.0.0-alpha.1](./whats-new/1.0.0-alpha.1.md)
`;

const NEXT = `# Next release

_Part of [What's new](../whats-new.md)._

- **A thing.** It works now.

## Upgrading from 1.0.0-alpha.1

Run \`ork migrate\`.
`;

describe("cutting What's new", () => {
  it("moves Next release's notes to the version's page", () => {
    const cut = cutRelease(HUB, NEXT, "1.0.0-alpha.2");
    expect(cut?.page).toBe(NEXT.replace("# Next release", "# 1.0.0-alpha.2"));
    expect(cut?.next).toBe(EMPTY_NEXT);
  });

  it("lists the page first, with its sections, under Next release", () => {
    expect(cutRelease(HUB, NEXT, "1.0.0-alpha.2")?.hub).toContain(
      `- [Next release](./whats-new/next-release.md)
- [1.0.0-alpha.2](./whats-new/1.0.0-alpha.2.md)
  - [Upgrading from 1.0.0-alpha.1](./whats-new/1.0.0-alpha.2.md#upgrading-from-100-alpha1)
- [1.0.0-alpha.1](./whats-new/1.0.0-alpha.1.md)
`,
    );
  });

  it.each([
    ["empty", EMPTY_NEXT],
    ["without its Part of line", "# Next release\n\n- **A thing.**\n"],
  ])("does nothing when Next release is %s", (_how, next) => {
    expect(cutRelease(HUB, next, "1.0.0-alpha.2")).toBeUndefined();
  });

  it("refuses a hub that doesn't list Next release", () => {
    expect(() => cutRelease("# What's new\n", NEXT, "1.0.0-alpha.2")).toThrow(
      /no line/u,
    );
  });
});
