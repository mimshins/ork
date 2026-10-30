import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkDocs } from "../check.ts";
import { anchors, relativeLinks, slugify } from "../markdown.ts";

const repo = (files: Record<string, string>): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-docs-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
};

const lines = (count: number): string =>
  Array.from({ length: count }, (_, i) => `line ${String(i)}`).join("\n");

describe("markdown", () => {
  it("slugs headings like GitHub", () => {
    expect(slugify("Runtime adapter (`packages/runtime-claude`)")).toBe(
      "runtime-adapter-packagesruntime-claude",
    );
    expect(slugify("UI (milestone 2): `ork ui` on localhost")).toBe(
      "ui-milestone-2-ork-ui-on-localhost",
    );
    expect(slugify("Messaging, decisions, logs")).toBe(
      "messaging-decisions-logs",
    );
  });

  it("numbers duplicate headings and reads html anchors", () => {
    const found = anchors('# A\n## A\n<a id="custom"></a>\n```\n# not\n```\n');
    expect([...found]).toEqual(["a", "a-1", "custom"]);
  });

  it("finds relative links outside code", () => {
    expect(
      relativeLinks(
        "[x](a.md#b) [y](https://e.com) `[z](c.md)` ![i](img.png)\n```\n[q](q.md)\n```",
      ).map(l => l.target),
    ).toEqual(["a.md#b", "img.png"]);
  });
});

describe("checkDocs", () => {
  it("passes a well-formed hub and chunks", () => {
    const root = repo({
      "README.md":
        "[spec](specs/area.md) [details](specs/area/details.md#details)",
      "specs/area.md": `# Area\n\nIntro.\n\n## Contents\n\n- [Details](./area/details.md)\n`,
      "specs/area/details.md": `# Details\n\n_Part of [Area](../area.md)._\n\nBody.\n`,
    });
    expect(checkDocs(root)).toEqual([]);
  });

  it("reports broken links and anchors", () => {
    const root = repo({
      "a.md": "# A\n[x](missing.md) [y](b.md#nope) [z](#a)",
      "b.md": "# B",
    });
    expect(checkDocs(root)).toEqual([
      "a.md:2: broken link missing.md",
      "a.md:2: b.md has no anchor #nope",
    ]);
  });

  it("requires long documents to be hubs", () => {
    const root = repo({ "specs/long.md": `# Long\n${lines(220)}\n` });
    expect(checkDocs(root)).toEqual([
      "specs/long.md: 221 lines; over 200, split it into a hub and chunks",
    ]);
  });

  it("checks chunks: hub, part-of line, contents listing, size", () => {
    const root = repo({
      "specs/area.md": "# Area\n\n## Contents\n\n- [One](./area/one.md)\n",
      "specs/area/one.md": "# One\n\n_Part of [Area](../area.md)._\n",
      "specs/area/two.md": "# Two\n\n_Part of [Area](../area.md)._\n",
      "specs/area/three.md": "# Three\n\nNo part-of line.\n",
      "specs/area/big.md": `# Big\n\n_Part of [Area](../area.md)._\n${lines(300)}\n`,
      "specs/orphan/x.md": "# X\n\n_Part of [O](../orphan.md)._\n",
      "docs/interaction-map/notes.md": "# Notes\n",
    });
    expect(checkDocs(root)).toEqual([
      "specs/area/big.md: not listed in the ## Contents of specs/area.md",
      "specs/area/big.md: 303 lines; split it into a section hub over 280",
      'specs/area/three.md: a chunk starts with "_Part of [<Hub>](<hub>.md)._" under its H1',
      "specs/area/two.md: not listed in the ## Contents of specs/area.md",
      "specs/orphan/x.md:3: broken link ../orphan.md",
      "specs/orphan/x.md: chunk folder specs/orphan/ has no hub specs/orphan.md",
    ]);
  });

  it("checks a symlinked folder once, at its target", () => {
    const root = repo({
      ".ai/skills/x/SKILL.md": "[up](../../../README.md)",
      "README.md": "# R",
    });
    mkdirSync(path.join(root, ".claude"));
    symlinkSync("../.ai/skills", path.join(root, ".claude/skills"));
    expect(checkDocs(root)).toEqual([]);
  });

  it("treats a folder without a hub as a category of standalone documents", () => {
    const root = repo({
      "runbook/development/release.md": "# Release\n",
      "runbook/development/long.md": `# Long\n${lines(220)}\n`,
    });
    expect(checkDocs(root)).toEqual([
      "runbook/development/long.md: 221 lines; over 200, split it into a hub and chunks",
    ]);
  });

  it("accepts a section hub that owns sibling chunks", () => {
    const root = repo({
      "specs/area.md":
        "# Area\n\n## Contents\n\n- [Section](./area/section.md)\n  - [Part](./area/part.md)\n",
      "specs/area/section.md":
        "# Section\n\n_Part of [Area](../area.md)._\n\n## Contents\n\n- [Part](./part.md)\n",
      "specs/area/part.md": "# Part\n\n_Part of [Section](./section.md)._\n",
    });
    expect(checkDocs(root)).toEqual([]);
  });
});
