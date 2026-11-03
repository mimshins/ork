/** @file Tests for the project filter's names. */

import { describe, expect, it } from "vitest";

import { projectOptions } from "../../src/panels/project-options.ts";

describe("the project filter's names", () => {
  it("tells apart two projects of the same name", () => {
    const options = projectOptions(
      [{ id: "tools", root: "/work/tools" }],
      [
        { project: "/a/one/app" },
        { project: "/a/two/app" },
        { project: "/work/tools" },
      ],
    );
    expect(options.map(option => option.label)).toEqual([
      "All projects",
      "tools",
      "one/app",
      "two/app",
    ]);
  });
});
