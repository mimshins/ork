/**
 * @file Runs the programs in this repository's own `start` and `plan`
 *   workflows: which files they will load, that saving never replaces a plan,
 *   and what QA's findings look like on disk.
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { afterEach, describe, expect, it } from "vitest";

const made: string[] = [];

/** The script of tool node `id` in this repository's workflow `name`. */
const scriptOf = (name: string, id: string): string => {
  const parsed = parseWorkflow(
    readFileSync(
      new URL(`../../../.ork/workflows/${name}.ork.yaml`, import.meta.url),
      "utf8",
    ),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const node = parsed.workflow.nodes[id];
  if (node?.type !== "tool.shell" || node.script === undefined) {
    throw new Error(`No script at ${id}.`);
  }
  return node.script;
};

/** A checkout with one Accepted RFC, one Draft RFC and one saved plan. */
const checkout = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-own-scripts-"));
  made.push(root);
  mkdirSync(path.join(root, "rfcs", "active"), { recursive: true });
  mkdirSync(path.join(root, ".ai", "plans"), { recursive: true });
  writeFileSync(
    path.join(root, "rfcs", "active", "RFC-001-a.md"),
    "- **Status:** Accepted (2026-11-07)\n",
  );
  writeFileSync(
    path.join(root, "rfcs", "active", "RFC-002-b.md"),
    "- **Status:** Draft\n",
  );
  writeFileSync(path.join(root, ".ai", "plans", "p.md"), "# Saved\n");
  return root;
};

/** Runs `script` in `cwd` with `env`, as Ork's `sh -eu` does. */
const run = (script: string, cwd: string, env: Record<string, string>) =>
  spawnSync("sh", ["-eu", "-c", script], {
    cwd,
    env: { PATH: process.env["PATH"] ?? "", ...env },
    encoding: "utf8",
  });

/** The result of `load_rfc` or `load_plan` on a target and a note. */
const load = (id: string, TARGET: string, NOTE = "") =>
  run(scriptOf("start", id), checkout(), { TARGET, NOTE });

describe("qa-pass's save", () => {
  it("writes each surface as markdown, naming one that did not finish", () => {
    const root = checkout();
    const FINDINGS = JSON.stringify([
      { summary: "Fine", findings: "Step 2 is\nwrong." },
      { summary: "claude exited with code 1" },
    ]);
    const result = run(scriptOf("qa-pass", "save"), root, {
      FINDINGS,
      ITEMS: JSON.stringify([{ name: "Quickstart" }, { name: "Worktrees" }]),
      RUN: "r1",
      SCOPE: "the guides",
    });
    expect(result.status).toBe(0);
    expect(
      readFileSync(path.join(root, ".ai", "plans", "qa-r1.md"), "utf8"),
    ).toBe(
      "# QA findings: the guides\n\nFrom run r1.\n\n## Quickstart\n\nStep 2 is\nwrong.\n\n## Worktrees\n\nNo report: claude exited with code 1.\n\n",
    );
  });
});

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Saves `PLAN` under `NAME` in `root`; returns the path it reports. */
const save = (root: string, NAME: string, PLAN: string): string =>
  run(scriptOf("plan", "save"), root, { NAME, PLAN, RUN: "abc" }).stdout;

describe("start's load programs", () => {
  it("loads an Accepted RFC", () => {
    expect(load("load_rfc", "rfcs/active/RFC-001-a.md").status).toBe(0);
  });

  it("refuses an RFC that is not Accepted", () => {
    expect(load("load_rfc", "rfcs/active/RFC-002-b.md").stderr).toContain(
      "not Accepted",
    );
  });

  it("loads a saved plan, and takes a leading ./", () => {
    expect(load("load_plan", "./.ai/plans/p.md").stdout).toBe("# Saved\n");
  });

  it("prefers the note to the recommended file", () => {
    expect(load("load_plan", "nope", ".ai/plans/p.md").status).toBe(0);
  });

  it("falls back to the target on a blank note", () => {
    expect(load("load_plan", ".ai/plans/p.md", "  ").status).toBe(0);
  });

  it.each(["../../x.md", ".ai/plans/../../x.md", "src/a.md", ""])(
    "refuses the path '%s'",
    target => {
      expect(load("load_plan", target).status).toBe(1);
    },
  );
});

describe("publishing", () => {
  it.each(["build", "rfc"])("checks %s before it connects to push", name => {
    const script = scriptOf(name, "publish");
    expect(script.indexOf("run check")).toBeGreaterThan(-1);
    expect(script.indexOf("run check")).toBeLessThan(
      script.indexOf("push --no-verify"),
    );
  });
});

describe("plan's save program", () => {
  it("saves under a cleaned name", () => {
    expect(save(checkout(), "my/odd plan", "x")).toBe(
      ".ai/plans/my-odd-plan.md",
    );
  });

  it("uses the run id with no name", () => {
    expect(save(checkout(), "", "x")).toBe(".ai/plans/abc.md");
  });

  it("never replaces a plan already there", () => {
    const root = checkout();
    expect(save(root, "p", "new")).toBe(".ai/plans/p-abc.md");
    expect(readFileSync(path.join(root, ".ai/plans/p.md"), "utf8")).toBe(
      "# Saved\n",
    );
    expect(readdirSync(path.join(root, ".ai/plans"))).toHaveLength(2);
  });
});
