/**
 * @file Tests for `ork context explain`: the resolved stack of one node in a
 *   fixture project, with a shadowed project skill and estimated tokens.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  explainNode,
  formatExplanation,
  tokens,
} from "../src/commands/context.ts";

const write = (root: string, file: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

const project = () => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-explain-")));
  const root = path.join(base, "app");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  write(root, "AGENTS.md", "# Agents\n");
  write(
    root,
    ".claude/skills/review/SKILL.md",
    "---\nname: review\n---\nproject\n",
  );
  write(
    root,
    ".ork/workflows/skills/review/SKILL.md",
    "---\nname: review\n---\nours\n",
  );
  write(root, ".ork/workflows/style.md", "Be brief.\n");
  write(
    root,
    ".ork/workflows/t.ork.yaml",
    [
      "schemaVersion: 1",
      "name: t",
      "layers:",
      "  skills: [./skills/review]",
      "  context: [./style.md]",
      "nodes:",
      "  fix:",
      "    type: claude.worker",
      "",
    ].join("\n"),
  );
  return { root, home: path.join(base, "home") };
};

/** The explanation, or the reason there is none as an error. */
const explained = (...args: Parameters<typeof explainNode>) => {
  const result = explainNode(...args);
  if (!result.ok) throw new Error(result.lines.join("\n"));
  return result.explanation;
};

describe("ork context explain", () => {
  it("shows each skill's layer and state, the context files and the tokens", () => {
    const { root, home } = project();
    const e = explained(".ork/workflows/t.ork.yaml", "fix", root, home);
    expect(e.instructions).toBe("AGENTS.md, loaded by Claude Code");
    expect(e.skills.map(s => [s.name, s.layer, s.state, s.why])).toEqual([
      ["review", "project", "off", "shadowed by the workflow layer"],
      ["ork:review", "workflow", "live", undefined],
    ]);
    expect(e.files).toEqual([
      {
        layer: "workflow",
        name: ".ork/workflows/style.md",
        tokens: tokens("Be brief.\n"),
      },
    ]);
    expect(e.practices.map(p => p.name)).toEqual(["caveman", "ponytail"]);
    expect(formatExplanation(e).join("\n")).toContain(
      "off: shadowed by the workflow layer",
    );
  });

  it("reports a node that does not exist", () => {
    const { root, home } = project();
    expect(
      explainNode(".ork/workflows/t.ork.yaml", "nope", root, home),
    ).toEqual({
      ok: false,
      lines: ['unknown node "nope"'],
    });
  });
});
