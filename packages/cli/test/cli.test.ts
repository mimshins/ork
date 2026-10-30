import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  findWorkflowFiles,
  formatPlan,
  formatReport,
  formatWorktrees,
  initProject,
  validateFile,
} from "../src/index.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const tempProject = () => mkdtempSync(path.join(tmpdir(), "ork-cli-"));

describe("ork validate", () => {
  it("reports the example as valid with a summary", () => {
    const report = validateFile("examples/software-factory.ork.yaml", repoRoot);
    expect(report.diagnostics).toEqual([]);
    expect(report.summary).toEqual({
      nodes: 9,
      edges: 11,
      entries: ["spec"],
    });
    expect(formatReport(report)).toEqual([
      "✓ examples/software-factory.ork.yaml (9 nodes, 11 edges, starts at spec)",
    ]);
  });

  it("locates compiler diagnostics in the source", () => {
    const dir = tempProject();
    writeFileSync(
      path.join(dir, "x.ork.yaml"),
      [
        "schemaVersion: 1",
        "name: x",
        "nodes:",
        "  a:",
        "    type: claude.worker",
        '    prompt: "{{inputs.nope}}"',
      ].join("\n"),
    );
    const report = validateFile("x.ork.yaml", dir);
    expect(formatReport(report)).toEqual([
      'x.ork.yaml:6:13 error "inputs.nope" reads an input the workflow does not declare (ref.input)',
      "✗ x.ork.yaml (1 error, 0 warnings)",
    ]);
  });

  it("reports a missing file", () => {
    expect(validateFile("nope.ork.yaml", tempProject()).diagnostics).toEqual([
      {
        severity: "error",
        code: "file.read",
        message: "file not found",
        path: [],
      },
    ]);
  });
});

describe("ork init", () => {
  it("scaffolds a valid starter and is idempotent", () => {
    const dir = tempProject();
    writeFileSync(path.join(dir, ".gitignore"), "node_modules/");

    expect(initProject(dir).created).toEqual([
      ".ork/workflows/hello.ork.yaml",
      ".gitignore (.ork/runs/)",
    ]);
    expect(initProject(dir)).toEqual({
      created: [],
      skipped: [".ork/workflows/hello.ork.yaml"],
    });

    expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe(
      "node_modules/\n# Ork run state\n.ork/runs/\n",
    );
    const starter = ".ork/workflows/hello.ork.yaml";
    expect(findWorkflowFiles([], dir)).toEqual([starter]);
    expect(validateFile(starter, dir).diagnostics).toEqual([]);
    expect(
      parseWorkflow(readFileSync(path.join(dir, starter), "utf8")).ok,
    ).toBe(true);
  });
});

describe("ork worktrees", () => {
  const item = {
    branch: "ork/r1/lead",
    runId: "r1",
    nodeId: "lead",
    path: "/w/ork-r1-lead",
    missing: false,
    dirty: true,
    ahead: 2,
    merged: false,
    inMainCheckout: false,
  };

  it("shows each branch's state and the clean plan", () => {
    expect(
      formatWorktrees([
        item,
        {
          ...item,
          branch: "ork/r1/fix",
          path: null,
          dirty: false,
          ahead: 0,
          merged: true,
        },
      ]),
    ).toEqual([
      "ork/r1/lead  uncommitted changes · 2 commit(s) not merged",
      "  /w/ork-r1-lead",
      "ork/r1/fix   no worktree · merged",
    ]);
    expect(
      formatPlan([
        {
          item,
          removeWorktree: false,
          deleteBranch: false,
          skip: "uncommitted changes",
        },
        {
          item: { ...item, branch: "ork/r1/fix" },
          removeWorktree: true,
          deleteBranch: true,
        },
      ]),
    ).toEqual([
      "  ork/r1/lead: keep (uncommitted changes)",
      "  ork/r1/fix: remove worktree + delete branch",
    ]);
    expect(formatWorktrees([])).toEqual(["No Ork worktrees or branches."]);
  });
});
