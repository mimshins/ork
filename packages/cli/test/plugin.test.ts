/**
 * @file Tests for Ork's Claude Code plugins (RFC-012): the marketplace lists
 *   both, each where it says, `ork`'s server runs `ork mcp`, and its hook stops
 *   `ork decide` in Claude Code's shell, however it's called, but lets a list
 *   through.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");

const json = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));

const HOOK = path.join(ROOT, "plugins/ork/hooks/no-decide.ts");

/** What the hook does with a Bash command: its exit code and what it says. */
const hook = (command?: string) => {
  const ran = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8",
  });
  return { code: ran.status, said: ran.stderr };
};

describe("Ork's Claude Code plugins", () => {
  it("are listed in the repository's marketplace, each where it says", () => {
    expect(json(".claude-plugin/marketplace.json")).toMatchObject({
      name: "ork",
      plugins: [
        { name: "ork", source: "./plugins/ork" },
        { name: "ork-dev", source: "./.ai" },
      ],
    });
    expect(json("plugins/ork/.claude-plugin/plugin.json")).toMatchObject({
      name: "ork",
    });
    expect(json(".ai/.claude-plugin/plugin.json")).toMatchObject({
      name: "ork-dev",
    });
  });

  it("run `ork mcp`, saying which Ork they need", () => {
    expect(json("plugins/ork/.mcp.json")).toMatchObject({
      mcpServers: {
        ork: { command: "ork", args: ["mcp", "--expects", expect.any(String)] },
      },
    });
  });

  it("give `ork-dev` the repository's own skills", () => {
    expect(
      [
        "write-an-rfc",
        "docs-structure",
        "knowledge-drift-sync",
        "resync-map",
      ].every(name =>
        existsSync(path.join(ROOT, ".ai/skills", name, "SKILL.md")),
      ),
    ).toBe(true);
  });
});

describe("the hook on Claude Code's shell", () => {
  it.each([
    "ork decide",
    "ork decide abc123 --id d1 --choose merge",
    "cd x && ork decide",
    "/usr/local/bin/ork decide",
    "npx @krapht/ork decide --all",
    "npx @krapht/ork@0.3.0 decide",
    "pnpm ork decide --id d --choose y",
  ])("stops `%s`, and says where the person answers", command => {
    expect(hook(command)).toEqual({
      code: 2,
      said: expect.stringContaining("ork ui") as unknown,
    });
  });

  it.each([
    "ork decide --list",
    "ork decide -l",
    "ork decide --list --json",
    "ork ps",
    "echo the work is decided",
    "git commit -m 'ork: decide later'",
  ])("lets `%s` through", command => {
    expect(hook(command).code).toBe(0);
  });

  it("lets anything through that isn't a command", () => {
    expect(hook().code).toBe(0);
  });
});
