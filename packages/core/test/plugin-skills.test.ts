/**
 * @file Tests for the skills Ork's Claude Code plugin teaches (RFC-012): each
 *   has a name and a description, none takes a built-in run skill's name, each
 *   `/ork:<name>` one names exists, `setup` asks before it changes anything or
 *   spends, and every workflow in one passes Ork's checks and walk with nothing
 *   to say, so a skill can't teach what Ork rejects.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkWorkflowText, walkChecks } from "../src/index.ts";

const skills = path.resolve(import.meta.dirname, "../../../plugins/ork/skills");
const names = readdirSync(skills);

const textOf = (name: string): string =>
  readFileSync(path.join(skills, name, "SKILL.md"), "utf8");

/** The workflows in a skill: its YAML blocks that are whole workflows. */
const workflowsIn = (text: string): string[] =>
  [...text.matchAll(/```yaml\n([\s\S]*?)```/gu)]
    .map(([, body]) => body ?? "")
    .filter(body => body.includes("schemaVersion:"));

/** The plugin skills a skill points to, as `/ork:<name>`. */
const namedIn = (text: string): string[] =>
  [...text.matchAll(/\/ork:([a-z-]+)/gu)].map(([, name]) => name ?? "");

const frontmatter = (text: string): Record<string, string> => {
  const pairs = (/^---\n([\s\S]*?)\n---/u.exec(text)?.[1] ?? "")
    .split("\n")
    .flatMap((line): [string, string][] => {
      const [, key, value] = /^(\w+): (.*)$/u.exec(line) ?? [];
      return key === undefined || value === undefined ? [] : [[key, value]];
    });
  return Object.fromEntries(pairs);
};

/** Everything Ork says of a workflow, in a project with nothing else. */
const said = async (text: string): Promise<string[]> => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-skill-"));
  const dir = path.join(root, ".ork");
  mkdirSync(path.join(dir, "workflows"), { recursive: true });
  const place = { root, dir, mode: "in-repo" as const };
  const { diagnostics } = await walkChecks(
    checkWorkflowText(text, {
      place,
      workflowDir: path.join(dir, "workflows"),
      registered: [],
      home: root,
    }),
  );
  return diagnostics.map(({ code, message }) => `${code}: ${message}`);
};

describe("the plugin's skills", () => {
  it("are RFC-012's three and setup, none a built-in run skill's", () => {
    expect(names.toSorted()).toEqual(["principles", "run", "setup", "write"]);
  });

  it("name only skills the plugin has", () => {
    const named = names.flatMap(name => namedIn(textOf(name)));
    expect(named.length).toBeGreaterThan(0);
    expect(names).toEqual(expect.arrayContaining(named));
  });

  it("have setup ask before it installs, edits a config or starts a run", () => {
    expect(textOf("setup")).toMatch(
      /Install, edit a config, or start a run without a yes\./u,
    );
    expect(textOf("setup")).toMatch(/Never ask for a key/u);
  });

  it.each(names)("%s has its name and a description", name => {
    expect(frontmatter(textOf(name))).toMatchObject({
      name,
      description: expect.stringMatching(/^Use when /u) as unknown,
    });
  });

  it("teach at least one whole workflow", () => {
    expect(
      names.flatMap(name => workflowsIn(textOf(name))).length,
    ).toBeGreaterThan(1);
  });

  it.each(
    names.flatMap(name =>
      workflowsIn(textOf(name)).map((text, at): [string, string] => [
        `${name} #${String(at + 1)}`,
        text,
      ]),
    ),
  )("%s passes Ork's checks and walk with nothing to say", async (_, text) => {
    expect(await said(text)).toEqual([]);
  });
});
