/**
 * @file Tests for `ork validate`, `ork init`, `ork link` and its doctor checks,
 *   the `ork worktrees` output, and a yes-or-no question on the terminal.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { parseWorkflow } from "@krapht/ork-schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  findWorkflowFiles,
  formatPlan,
  formatReport,
  formatLinks,
  formatWorktrees,
  initProject,
  linkChecks,
  validateFile,
} from "../src/index.ts";
import { confirm } from "../src/output.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const tempProject = () => mkdtempSync(path.join(tmpdir(), "ork-cli-"));

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const TRIAGE =
  "schemaVersion: 1\nname: triage\nnodes:\n  a: { type: tool.shell, command: x }\nlimits: { budgetUsd: 1 }\n";

/** `ork validate` for real, in a project with these triggers and its own `~`. */
const validateWithTriggers = (triggers: string, ...args: string[]) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-cli-")));
  const home = path.join(root, "home");
  const repo = path.join(root, "repo");
  mkdirSync(home);
  mkdirSync(path.join(repo, ".ork", "workflows"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(path.join(repo, ".ork/workflows/triage.ork.yaml"), TRIAGE);
  writeFileSync(
    path.join(repo, ".ork/triggers.yaml"),
    `schemaVersion: 1\ntriggers:\n${triggers}`,
  );
  return spawnSync(process.execPath, [BIN, "validate", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      ORK_NO_UPDATE_CHECK: "1",
    },
  });
};

const VALID = "  good: { every: 1m, run: triage }\n";
const INVALID = "  broken: { every: 1m, run: gone }\n";

/** `ork validate` for real, on one file with this text. */
const validateText = (text: string, ...args: string[]) => {
  const dir = tempProject();
  writeFileSync(path.join(dir, "w.ork.yaml"), text);
  return spawnSync(process.execPath, [BIN, "validate", "w.ork.yaml", ...args], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: dir,
      ORK_NO_UPDATE_CHECK: "1",
    },
  });
};

const GATED = [
  "schemaVersion: 1",
  "name: gated",
  "nodes:",
  "  ask: { type: human.gate, question: Go?, options: [go, keep] }",
  '  ship: { type: tool.shell, command: "true", allow: ["true"] }',
  "edges:",
  "  - { from: ask, to: ship, when: \"choice == 'go'\" }",
  "",
].join("\n");

const STRANDED = [
  "schemaVersion: 1",
  "name: stranded",
  "nodes:",
  '  a: { type: tool.shell, command: "true", allow: ["true"] }',
  '  b: { type: tool.shell, command: "true", allow: ["true"] }',
  "edges:",
  '  - { from: a, to: b, when: "false" }',
  "",
].join("\n");

const parallel = (count: number): string =>
  [
    "schemaVersion: 1",
    "name: wide",
    "nodes:",
    "  s: { type: control.split }",
    ...Array.from(
      { length: count },
      (_, at) => `  n${String(at)}: { type: agent.worker, prompt: x }`,
    ),
    "edges:",
    ...Array.from({ length: count }, (_, at) => `  - s -> n${String(at)}`),
    "",
  ].join("\n");

/** `ork validate` for real, in a folder with no `.ork/`. */
const validateBare = () => {
  const dir = tempProject();
  return spawnSync(process.execPath, [BIN, "validate"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: dir,
      ORK_NO_UPDATE_CHECK: "1",
    },
  });
};

describe("ork validate without a project", () => {
  it("says to run ork init when there is no .ork folder", () => {
    const { status, stdout } = validateBare();
    expect(status).toBe(1);
    expect(stdout).toContain("Run `ork init`");
  });
});

describe("ork validate's walk", () => {
  it("says how many ways it walked", () => {
    const { status, stdout } = validateText(GATED);
    expect(status).toBe(0);
    expect(stdout).toContain("Walked 3 ways through: 2 succeed, 1 fails.");
    expect(stdout).toContain("See each with `ork validate --paths`.");
    expect(validateText(GATED, "--paths").stdout).not.toContain(
      "See each with",
    );
  });

  it("reports what it found as a warning, with its line", () => {
    const { status, stdout } = validateText(STRANDED);
    expect(status).toBe(0);
    expect(stdout).toMatch(
      /w\.ork\.yaml:5:\d+ warning no way the walk tried reaches `b`/u,
    );
  });

  it("says when it stopped, and claims nothing", () => {
    const { stdout } = validateText(parallel(14));
    // A slow machine runs out of time before it reaches the cap of ways.
    expect(stdout).toMatch(
      /Walked [\d,]+ ways through and stopped; not every way was tried\./u,
    );
    expect(stdout).not.toContain("walk.");
  });

  it("doesn't walk a file with errors", () => {
    const { status, stdout } = validateText(
      GATED.replace("choice == 'go'", "choice == 'og'"),
    );
    expect(status).toBe(1);
    expect(stdout).not.toContain("Walked");
  });

  it("lists how a run can end only when asked", () => {
    expect(validateText(GATED).stdout).not.toContain("didn't run");
  });

  it("lists a gate's answer that ends the run as an ending", () => {
    const { stdout } = validateText(GATED, "--paths");
    expect(stdout).toMatch(
      /succeeded \(1 way\) didn't run: ship\n +ask: choice = keep/u,
    );
    expect(stdout).not.toContain("warning");
  });

  it("carries the walk in its JSON", () => {
    const { stdout } = validateText(GATED, "--json");
    expect(stdout).toContain('"paths": 3');
    expect(stdout).toContain('"endings"');
  });
});

describe("ork validate on a project's triggers", () => {
  it("reports an invalid one, and fails", () => {
    const { status, stdout } = validateWithTriggers(VALID + INVALID);
    expect(status).toBe(1);
    expect(stdout).toMatch(
      /\.ork\/triggers\.yaml:\d+:\d+ error .*gone.*\(trigger\.\w+\)/u,
    );
    expect(stdout).toContain("✗ .ork/triggers.yaml (1 error, 0 warnings)");
  });

  it("has nothing to say of a valid one", () => {
    const { status, stdout } = validateWithTriggers(VALID);
    expect(status).toBe(0);
    expect(stdout).toContain("✓ .ork/triggers.yaml");
    expect(stdout).not.toContain("error");
  });

  it("reads them only when no workflow is named", () => {
    const { status, stdout } = validateWithTriggers(
      INVALID,
      ".ork/workflows/triage.ork.yaml",
    );
    expect(status).toBe(0);
    expect(stdout).not.toContain("triggers.yaml");
  });
});

describe("ork validate", () => {
  it("reports the example as valid with a summary", () => {
    const report = validateFile("examples/software-factory.ork.yaml", repoRoot);
    expect(report.diagnostics).toEqual([]);
    expect(report.summary).toEqual({
      nodes: 11,
      edges: 14,
      entries: ["spec"],
    });
    expect(formatReport(report)).toEqual([
      "✓ examples/software-factory.ork.yaml (11 nodes, 14 edges, starts at spec)",
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
        "    type: agent.worker",
        '    prompt: "{{inputs.nope}}"',
      ].join("\n"),
    );
    const report = validateFile("x.ork.yaml", dir);
    expect(formatReport(report)).toEqual([
      "x.ork.yaml:6:13 error `inputs.nope` reads an input the workflow does not declare (ref.input)",
      "✗ x.ork.yaml (1 error, 0 warnings)",
    ]);
  });

  it("refuses a renamed node type, naming the new one and `ork migrate`", () => {
    const dir = tempProject();
    writeFileSync(
      path.join(dir, "x.ork.yaml"),
      "schemaVersion: 1\nname: x\nnodes:\n  a:\n    type: claude.worker\n    prompt: hi\n",
    );
    expect(formatReport(validateFile("x.ork.yaml", dir))).toEqual([
      "x.ork.yaml:5:11 error `claude.worker` was renamed to `agent.worker`; run `ork migrate` (schema.invalid_union)",
      "✗ x.ork.yaml (1 error, 0 warnings)",
    ]);
  });

  it("locates a forEach diagnostic at its key", () => {
    const dir = tempProject();
    writeFileSync(
      path.join(dir, "x.ork.yaml"),
      [
        "schemaVersion: 1",
        "name: x",
        "nodes:",
        "  a:",
        "    type: agent.worker",
        "    prompt: Go",
        '    forEach: { from: "{{nodes.b.output.json.x}}", maxItems: 2 }',
        "  b: { type: tool.shell, command: x, output: { format: json } }",
      ].join("\n"),
    );
    expect(formatReport(validateFile("x.ork.yaml", dir))).toEqual([
      "x.ork.yaml:7:22 error `nodes.b.output.json.x`: `b` does not run before `a`, so its list can't exist when `a` starts (forEach.order)",
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
      links: [],
    });

    expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe(
      "node_modules/\n# Ork run state\n.ork/runs/\n",
    );
    const starter = ".ork/workflows/hello.ork.yaml";
    expect(findWorkflowFiles([], dir)).toEqual([starter]);
    expect(findWorkflowFiles(["hello"], dir)).toEqual([starter]);
    expect(validateFile(starter, dir).diagnostics).toEqual([]);
    expect(
      parseWorkflow(readFileSync(path.join(dir, starter), "utf8")).ok,
    ).toBe(true);
  });
});

describe("ork init and ork link", () => {
  it("links the tool folders a project uses, and says what it kept", () => {
    const dir = tempProject();
    mkdirSync(path.join(dir, ".claude/agents"), { recursive: true });

    const { created, links } = initProject(dir, { link: true });
    expect(created).toEqual([
      ".ork/workflows/hello.ork.yaml",
      ".gitignore (.ork/runs/)",
      ".ork/skills",
      ".ork/skills/.gitkeep",
      ".claude/skills",
    ]);
    expect(formatLinks(links, created)).toEqual([
      "kept    .claude/agents is a real folder, left as it is",
      "linked  .claude/skills → .ork/skills",
    ]);
    expect(linkChecks(dir)).toEqual([
      {
        name: "Claude Code links",
        status: "skip",
        detail:
          ".claude/agents is a real folder, left as it is; .claude/skills → .ork/skills",
      },
    ]);
  });

  it("has the doctor check links only once a project has .ork/", () => {
    const dir = tempProject();
    mkdirSync(path.join(dir, ".claude"));
    expect(linkChecks(dir)).toEqual([]);
    mkdirSync(path.join(dir, ".ork"));
    expect(linkChecks(dir)).toMatchObject([
      { name: "Claude Code links", status: "warn" },
    ]);
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
    changes: 1,
    ahead: 2,
    merged: false,
    inMainCheckout: false,
    recorded: true,
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
          changes: 0,
          ahead: 0,
          merged: true,
        },
        {
          runId: "r1",
          nodeId: "check",
          path: "/w/ork-r1-check",
          missing: false,
          dirty: false,
          changes: 0,
          ahead: 1,
          merged: false,
          inMainCheckout: false,
          recorded: true,
        },
      ]),
    ).toEqual([
      "ork/r1/lead          uncommitted changes · 2 commits not merged",
      "  /w/ork-r1-lead",
      "ork/r1/fix           merged · no worktree",
      "r1/check (detached)  detached · 1 commit on no branch",
      "  /w/ork-r1-check",
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

/** Answers `confirm` with what's typed, as a terminal's input would. */
const confirmTyping = (typed: string): Promise<boolean> => {
  const input = new PassThrough();
  vi.spyOn(process, "stdin", "get").mockReturnValue(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stands in for a terminal
    input as unknown as typeof process.stdin,
  );
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const answer = confirm("Accept? ");
  input.end(typed);
  return answer;
};

describe("a yes-or-no question", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("takes input ending as no, rather than waiting for ever", async () => {
    expect(await confirmTyping("")).toBe(false);
  });

  it("takes yes as yes", async () => {
    expect(await confirmTyping("yes\n")).toBe(true);
  });
});
