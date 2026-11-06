/**
 * @file Tests for Ork's skills in a project (RFC-012): `ork init --skills`
 *   writes them as `ork-<name>`, naming the Ork that wrote them, and links
 *   Claude Code's folder there; it rewrites Ork's own old copies, never a skill
 *   someone else wrote; and `ork doctor` says when a copy is older than Ork.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  hasSkills,
  projectSkill,
  skillChecks,
  stampOf,
  writeSkills,
} from "../src/project/init-skills.ts";

const project = (): string => mkdtempSync(path.join(tmpdir(), "ork-skills-"));

const skillFile = (root: string, name: string): string =>
  path.join(root, ".ork", "skills", name, "SKILL.md");

const read = (root: string, name: string): string =>
  readFileSync(skillFile(root, name), "utf8");

describe("Ork's skills in a project", () => {
  it("are written as ork-<name>, naming the Ork that wrote them", () => {
    const root = project();
    const result = writeSkills(root, "1.0.0", { link: false });
    expect(result.created).toEqual([
      ".ork/skills/ork-principles/SKILL.md",
      ".ork/skills/ork-run/SKILL.md",
      ".ork/skills/ork-write/SKILL.md",
    ]);
    const write = read(root, "ork-write");
    expect(write).toMatch(/^---\nname: ork-write\n/u);
    expect(stampOf(write)).toBe("1.0.0");
    expect(write).not.toContain("/ork:");
    expect(hasSkills(root)).toBe(true);
  });

  it("link Claude Code's skills folder to them", () => {
    const root = project();
    writeSkills(root, "1.0.0", { link: true });
    expect(
      readFileSync(
        path.join(root, ".claude", "skills", "ork-run", "SKILL.md"),
        "utf8",
      ),
    ).toBe(read(root, "ork-run"));
  });

  it("leave a current copy, and rewrite an older one", () => {
    const root = project();
    writeSkills(root, "1.0.0", { link: false });
    expect(writeSkills(root, "1.0.0", { link: false }).created).toEqual([]);
    const again = writeSkills(root, "1.1.0", { link: false });
    expect(again.updated).toHaveLength(3);
    expect(stampOf(read(root, "ork-run"))).toBe("1.1.0");
  });

  it("keep a copy a newer Ork wrote", () => {
    const root = project();
    writeSkills(root, "1.1.0", { link: false });
    const older = writeSkills(root, "1.0.0", { link: false });
    expect(older.updated).toEqual([]);
    expect(older.newer).toContain(".ork/skills/ork-run/SKILL.md (Ork 1.1.0)");
    expect(stampOf(read(root, "ork-run"))).toBe("1.1.0");
  });

  it("never rewrite a skill someone else wrote under that name", () => {
    const root = project();
    mkdirSync(path.dirname(skillFile(root, "ork-run")), { recursive: true });
    writeFileSync(
      skillFile(root, "ork-run"),
      "---\nname: ork-run\n---\nMine.\n",
    );
    const result = writeSkills(root, "1.0.0", { link: false });
    expect(result.skipped).toEqual([".ork/skills/ork-run/SKILL.md"]);
    expect(read(root, "ork-run")).toContain("Mine.");
  });

  it("are reported by doctor when older than Ork", () => {
    const root = project();
    writeSkills(root, "1.0.0", { link: false });
    expect(skillChecks(root, "1.0.0")).toEqual([]);
    expect(skillChecks(root, "1.2.0")).toEqual([
      expect.objectContaining({
        status: "warn",
        hint: "Rewrite them with `ork init --skills`.",
      }),
    ]);
  });

  it("say nothing in a project without them", () => {
    expect(skillChecks(project(), "1.0.0")).toEqual([]);
    expect(hasSkills(project())).toBe(false);
  });

  it("rename a plugin skill and its references for a project", () => {
    const text =
      "---\nname: write\ndescription: d\n---\nSee /ork:principles.\n";
    expect(projectSkill("write", text, "2.0.0")).toBe(
      "---\nname: ork-write\ndescription: d\n---\n\n<!-- Ork 2.0.0 wrote this with `ork init --skills`, which rewrites it. To keep your own version, rename its folder. -->\nSee /ork-principles.\n",
    );
  });
});
