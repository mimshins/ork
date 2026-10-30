import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  applyClean,
  compileWorkflow,
  type CompiledGraph,
  createWorkspace,
  createWorktree,
  inspectProject,
  listOrkWorktrees,
  type NodeExecutor,
  planClean,
  type RunEvent,
  startRun,
  worktreePath,
} from "../src/index.ts";

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

const write = (root: string, file: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

/** A repo shaped like se-backend: skills in `.ai`, linked from `.claude`. */
const repo = (): string => {
  const root = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "ork-wt-"))),
    "app",
  );
  mkdirSync(root);
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.email", "dev@example.com");
  sh(root, "config", "user.name", "Dev");
  sh(root, "config", "commit.gpgsign", "false");
  write(root, "CLAUDE.md", "# Project\n");
  write(
    root,
    ".gitignore",
    "CLAUDE.local.md\n.claude/settings.local.json\n.env\nsecret.txt\n.ork/runs/\n",
  );
  write(root, ".worktreeinclude", ".env\n");
  write(root, ".ai/skills/review/SKILL.md", "---\nname: review\n---\n");
  mkdirSync(path.join(root, ".claude"));
  symlinkSync("../.ai/skills", path.join(root, ".claude/skills"));
  write(root, "src/app.ts", "export {};\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "init");
  write(root, "CLAUDE.local.md", "personal\n");
  write(root, ".claude/settings.local.json", "{}\n");
  write(root, ".env", "TOKEN=local\n");
  write(root, "secret.txt", "not copied\n");
  return root;
};

const compile = (yaml: string): CompiledGraph => {
  const parsed = parseWorkflow(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

type Work = {
  files?: Record<string, string>;
  artifacts?: Record<string, string>;
};

/** Writes each node's files where it runs and records its cwd. */
const working = (work: Record<string, Work>) => {
  const cwds: Record<string, string> = {};
  const prompts: Record<string, string | undefined> = {};
  const executor: NodeExecutor = context => {
    cwds[context.id] = context.cwd;
    prompts[context.id] = context.checkout?.branch;
    for (const [file, text] of Object.entries(work[context.id]?.files ?? {})) {
      write(context.cwd, file, text);
    }
    return Promise.resolve({
      ok: true,
      output: {
        status: "pass",
        summary: "ok",
        artifacts: work[context.id]?.artifacts ?? {},
      },
    });
  };
  return { executor, cwds, prompts };
};

const runIn = async (
  root: string,
  graph: CompiledGraph,
  executor: NodeExecutor,
) => {
  const project = await inspectProject(root);
  if (project === null) throw new Error("not a repo");
  const events: RunEvent[] = [];
  const onEvent = (event: RunEvent) => {
    events.push(event);
  };
  const handle = startRun({
    graph,
    runId: "r1",
    inputs: {},
    cwd: root,
    executors: { "claude.leader": executor, "claude.worker": executor },
    human: {
      ask: () => Promise.resolve("stop"),
      permit: () => Promise.resolve({ allow: true }),
    },
    onEvent,
    workspace: createWorkspace({
      graph,
      runId: "r1",
      root,
      head: project.head,
      onEvent,
    }),
  });
  const result = await handle.done;
  const worktreeEvents = events.flatMap(e =>
    e.type === "worktree" ? [`${e.id} ${e.action}`] : [],
  );
  return { result, worktreeEvents };
};

const TEAM = compile(
  [
    "schemaVersion: 1",
    "name: team",
    "nodes:",
    "  spec: { type: claude.worker, isolation: shared }",
    "  lead: { type: claude.leader }",
    "  fix: { type: claude.worker, parent: lead }",
    "  check: { type: claude.worker, parent: lead, isolation: readonly }",
    "edges:",
    "  - spec -> lead",
    "  - lead -> fix",
    "  - fix -> check",
  ].join("\n"),
);

describe("the project check", () => {
  it("finds uncommitted instructions and skills, through symlinks", async () => {
    const root = repo();
    expect(await inspectProject(root)).toMatchObject({
      dirtyAgentFiles: [],
      dirtyOther: 0,
    });
    write(root, ".ai/skills/review/SKILL.md", "changed\n");
    write(root, "AGENTS.md", "# new\n");
    write(root, "src/app.ts", "export const x = 1;\n");
    expect(await inspectProject(root)).toMatchObject({
      dirtyAgentFiles: [".ai/skills/review/SKILL.md", "AGENTS.md"],
      dirtyOther: 1,
    });
    expect(await inspectProject(tmpdir())).toBeNull();
  });
});

describe("worktrees", () => {
  it("live beside the clone, with the local agent files and .worktreeinclude", async () => {
    const root = repo();
    const created = await createWorktree({
      root,
      runId: "r1",
      nodeId: "lead",
      base: sh(root, "rev-parse", "HEAD").trim(),
    });

    expect(created.path).toBe(
      path.join(path.dirname(root), "app-worktrees", "ork-r1-lead"),
    );
    expect(created.branch).toBe("ork/r1/lead");
    expect(created.copied.toSorted()).toEqual([
      ".claude/settings.local.json",
      ".env",
      "CLAUDE.local.md",
    ]);
    expect(existsSync(path.join(created.path, "secret.txt"))).toBe(false);
    expect(
      existsSync(path.join(created.path, ".claude/skills/review/SKILL.md")),
    ).toBe(true);
  });

  it("runs owners and children in worktrees and merges a passing child", async () => {
    const root = repo();
    const { executor, cwds, prompts } = working({
      spec: {
        files: { "spec.md": "# Spec\n" },
        artifacts: { spec: "spec.md" },
      },
      lead: { files: { "src/lead.ts": "lead\n" } },
      fix: { files: { "src/fix.ts": "fix\n" } },
    });
    const { result, worktreeEvents } = await runIn(root, TEAM, executor);
    const lead = worktreePath(root, "r1", "lead");

    expect(result.status).toBe("succeeded");
    expect(cwds).toEqual({
      spec: root,
      lead,
      fix: worktreePath(root, "r1", "fix"),
      check: lead,
    });
    expect(prompts).toEqual({
      spec: undefined,
      lead: "ork/r1/lead",
      fix: "ork/r1/fix",
      check: "ork/r1/lead",
    });
    expect(worktreeEvents).toEqual([
      "lead created",
      "lead committed",
      "fix created",
      "fix committed",
      "fix merged",
      "fix removed",
    ]);
    // The spec written in the project root was carried onto the lead's branch,
    // and the fix was merged into it.
    expect(sh(lead, "ls-files", "spec.md", "src/fix.ts", "src/lead.ts")).toBe(
      "spec.md\nsrc/fix.ts\nsrc/lead.ts\n",
    );
    expect(result.nodes.find(n => n.id === "lead")?.output?.["branch"]).toBe(
      "ork/r1/lead",
    );
    expect(result.worktrees).toEqual([
      {
        id: "lead",
        path: lead,
        branch: "ork/r1/lead",
        reason: "the run's result",
      },
    ]);
    expect(existsSync(worktreePath(root, "r1", "fix"))).toBe(false);
  });

  it("keeps a child whose merge conflicts, and tells the owner which files", async () => {
    const root = repo();
    const graph = compile(
      [
        "schemaVersion: 1",
        "name: clash",
        "nodes:",
        "  lead: { type: claude.leader }",
        "  a: { type: claude.worker, parent: lead }",
        "  b: { type: claude.worker, parent: lead }",
        "edges:",
        "  - lead -> a, b",
      ].join("\n"),
    );
    const { executor } = working({
      a: { files: { "src/app.ts": "A\n" } },
      b: { files: { "src/app.ts": "B\n" } },
    });
    const { result } = await runIn(root, graph, executor);
    const kept = result.worktrees.map(w => `${w.id}: ${w.reason}`).toSorted();
    expect(kept).toHaveLength(2);
    expect(kept).toContain("lead: the run's result");
    expect(kept.some(k => k.endsWith("merge conflict in src/app.ts"))).toBe(
      true,
    );
    expect(sh(worktreePath(root, "r1", "lead"), "status", "--porcelain")).toBe(
      "",
    );
  });

  it("fails a node whose leftovers the repo's hooks refuse, and keeps its worktree", async () => {
    const root = repo();
    write(
      root,
      "hooks/pre-commit",
      "#!/bin/sh\necho 'lint failed' >&2\nexit 1\n",
    );
    chmodSync(path.join(root, "hooks/pre-commit"), 0o755);
    sh(root, "config", "core.hooksPath", path.join(root, "hooks"));
    const graph = compile(
      [
        "schemaVersion: 1",
        "name: one",
        "nodes:",
        "  lead: { type: claude.leader }",
      ].join("\n"),
    );
    const { executor } = working({ lead: { files: { "src/x.ts": "x\n" } } });
    const { result } = await runIn(root, graph, executor);
    expect(result.status).toBe("failed");
    expect(result.reasons[0]).toMatch(
      /^lead: could not commit its work: git commit failed/u,
    );
    expect(
      readFileSync(
        path.join(worktreePath(root, "r1", "lead"), "src/x.ts"),
        "utf8",
      ),
    ).toBe("x\n");
  });
});

describe("ork worktrees", () => {
  it("lists Ork's branches from git and cleans them safely", async () => {
    const root = repo();
    const { executor } = working({
      lead: { files: { "a.ts": "a\n" } },
      fix: { files: { "b.ts": "b\n" } },
    });
    await runIn(root, TEAM, executor);
    write(worktreePath(root, "r1", "lead"), "wip.ts", "wip\n");

    const items = await listOrkWorktrees(root);
    expect(
      items.map(i => [i.branch, i.path !== null, i.dirty, i.merged]),
    ).toEqual([
      ["ork/r1/fix", false, false, false],
      ["ork/r1/lead", true, true, false],
    ]);

    const careful = planClean(
      items,
      { merged: false },
      { branches: true, force: false },
    );
    expect(
      careful.map(s => [
        s.item.nodeId,
        s.removeWorktree,
        s.deleteBranch,
        s.skip,
      ]),
    ).toEqual([
      ["fix", false, false, "branch not merged"],
      ["lead", false, false, "uncommitted changes"],
    ]);

    const forced = planClean(
      items,
      { merged: false, runId: "r1" },
      { branches: true, force: true },
    );
    expect(await applyClean(root, forced, true)).toEqual([
      "deleted ork/r1/fix",
      `removed ${worktreePath(root, "r1", "lead")}`,
      "deleted ork/r1/lead",
    ]);
    expect(await listOrkWorktrees(root)).toEqual([]);
  });
});
