/**
 * @file Tests that the CLI's bundled copy of the plugin's skills matches
 *   `plugins/ork/skills/`, as `tools/release/plugin-skills.ts` writes it.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SKILLS_MODULE, skillsModule } from "../plugin-skills.ts";

describe("the bundled skills", () => {
  it("match plugins/ork/skills/ (run node tools/release/plugin-skills.ts)", () => {
    expect(readFileSync(SKILLS_MODULE, "utf8")).toBe(skillsModule());
  });
});
