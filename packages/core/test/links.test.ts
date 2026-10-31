/**
 * @file Tests for linking tool folders to `.ork/`: only missing folders become
 *   links, real folders and links elsewhere are kept, an empty origin gets a
 *   keep file, a link whose origin is missing gets it back, linking twice
 *   changes nothing, and agents in `.ork/agents` are read once through links.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createAgent,
  linkTools,
  loadAgents,
  toolLinks,
  toolsInUse,
} from "../src/index.ts";

const temp = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

/**
 * `.claude/` is empty, `.ai/agents` is a real folder, `.opencode/agents` links
 * to it.
 */
const project = (): string => {
  const root = temp("ork-link-");
  mkdirSync(path.join(root, ".claude"));
  mkdirSync(path.join(root, ".ai/agents"), { recursive: true });
  writeFileSync(
    path.join(root, ".ai/agents/keep.md"),
    "---\nname: keep\n---\n",
  );
  mkdirSync(path.join(root, ".opencode"));
  symlinkSync("../.ai/agents", path.join(root, ".opencode/agents"));
  return root;
};

const states = (root: string, tools?: readonly string[]) =>
  toolLinks(root, tools).map(l => [l.path, l.state, l.target]);

describe("linking tool folders to .ork/", () => {
  it("links what is missing and keeps real folders and other links", () => {
    const root = project();
    expect(toolsInUse(root)).toEqual(["claude", "opencode", "ai"]);

    const result = linkTools(root, toolsInUse(root));
    expect(result).toMatchObject({
      ok: true,
      created: [
        ".ork/agents",
        ".ork/agents/.gitkeep",
        ".claude/agents",
        ".ork/skills",
        ".ork/skills/.gitkeep",
        ".claude/skills",
        ".opencode/skills",
        ".ai/skills",
      ],
    });
    expect(states(root, toolsInUse(root))).toEqual([
      [".claude/agents", "linked", undefined],
      [".claude/skills", "linked", undefined],
      [".opencode/agents", "elsewhere", "../.ai/agents"],
      [".opencode/skills", "linked", undefined],
      [".ai/agents", "folder", undefined],
      [".ai/skills", "linked", undefined],
    ]);
    expect(readlinkSync(path.join(root, ".claude/agents"))).toBe(
      "../.ork/agents",
    );
    expect(existsSync(path.join(root, ".agents"))).toBe(false);

    expect(linkTools(root, toolsInUse(root))).toMatchObject({
      ok: true,
      created: [],
    });
  });

  it("reads an agent in .ork/agents once, through its links", () => {
    const root = project();
    linkTools(root, ["claude"]);
    createAgent("approver", {}, { scope: "project", projectRoot: root });
    const catalog = loadAgents({ projectRoot: root, home: temp("ork-home-") });
    expect(
      catalog.agents
        .filter(a => a.name === "approver")
        .map(a => [a.where, a.via]),
    ).toEqual([[".ork/agents/approver.md", [".claude/agents"]]]);
  });

  it("gives a link its missing origin, as after a fresh clone", () => {
    const root = temp("ork-link-");
    mkdirSync(path.join(root, ".claude"));
    symlinkSync("../.ork/agents", path.join(root, ".claude/agents"));
    symlinkSync("../nowhere", path.join(root, ".claude/skills"));
    expect(states(root, ["claude"])).toEqual([
      [".claude/agents", "broken", "../.ork/agents"],
      [".claude/skills", "broken", "../nowhere"],
    ]);

    linkTools(root, ["claude"]);
    expect(states(root, ["claude"])).toEqual([
      [".claude/agents", "linked", undefined],
      [".claude/skills", "broken", "../nowhere"],
    ]);
  });

  it("names the tools it knows when given another", () => {
    expect(linkTools(temp("ork-link-"), ["claude", "vim"])).toEqual({
      ok: false,
      error: "Unknown tool vim; known: claude, agents, opencode, ai.",
    });
  });
});
