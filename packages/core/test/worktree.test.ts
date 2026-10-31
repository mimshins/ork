/**
 * @file Tests for Ork's worktrees in real temporary git repositories: the
 *   project check, worktree setup, merges and conflicts, refused commits, and
 *   `ork worktrees`.
 */

import { chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyClean,
  createWorktree,
  inspectProject,
  listOrkWorktrees,
  type NodeExecutor,
  planClean,
  worktreePath,
  branchName,
  upstreamPlace,
} from "../src/index.ts";
import { compile, repo, runIn, sh, working, write } from "./fixtures/git.ts";

/** `executor`, except that `check` fails. */
const failingCheck =
  (executor: NodeExecutor): NodeExecutor =>
  context =>
    context.id === "check"
      ? Promise.resolve({ ok: false, output: { status: "fail" }, error: "no" })
      : executor(context);

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
      path: worktreePath(root, "r1", "lead"),
      branch: branchName("r1", "lead"),
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

  it("puts a readonly node with no owner in the worktree its input came from", async () => {
    const root = repo();
    const graph = compile(
      [
        "schemaVersion: 1",
        "name: review",
        "nodes:",
        "  lead: { type: claude.leader }",
        "  other: { type: claude.worker }",
        "  reviews: { type: control.join }",
        "  approve: { type: claude.worker, isolation: readonly }",
        "  both: { type: control.join }",
        "  judge: { type: claude.worker, isolation: readonly }",
        "edges:",
        "  - lead -> reviews",
        "  - reviews -> approve",
        "  - lead, other -> both",
        "  - both -> judge",
      ].join("\n"),
    );
    const { executor, cwds, prompts } = working({});
    const { result } = await runIn(root, graph, executor);
    expect(result.status).toBe("succeeded");
    // Through a join to the leader's worktree; with two worktrees upstream,
    // the project root.
    expect(cwds["approve"]).toBe(worktreePath(root, "r1", "lead"));
    expect(prompts["approve"]).toBe("ork/r1/lead");
    expect(cwds["judge"]).toBe(root);
  });

  it("follows a readonly node's input back through a human gate", () => {
    const graph = compile(
      [
        "schemaVersion: 1",
        "name: gated",
        "nodes:",
        "  build: { type: claude.worker }",
        "  ready: { type: human.gate, question: Review?, options: [go, stop] }",
        "  review: { type: claude.worker, isolation: readonly }",
        "edges:",
        "  - build -> ready",
        "  - ready -> review",
      ].join("\n"),
    );
    const places = new Map([
      ["build", "/wt/build"],
      ["ready", "/repo"],
    ]);
    expect(upstreamPlace(graph, "review", places, "/repo")).toBe("/wt/build");
  });

  it("resumes in the worktrees a run left, and reuses a removed one's branch", async () => {
    const root = repo();
    const lead = worktreePath(root, "r1", "lead");
    const { executor } = working({ fix: { files: { "src/fix.ts": "fix\n" } } });
    const failing = failingCheck(executor);
    const first = await runIn(root, TEAM, failing);
    expect(first.result.status).toBe("failed");

    const { executor: second, cwds } = working({});
    const again = await runIn(root, TEAM, second, first.events);
    expect(again.result.status).toBe("succeeded");
    // Only the failed node ran, in the lead's worktree, which was adopted.
    expect(cwds).toEqual({ check: lead });
    expect(again.worktreeEvents).toEqual([]);
    expect(again.result.worktrees.map(w => w.id)).toEqual(["lead"]);
    // fix's worktree was removed after its merge; its branch is checked out
    // again rather than created.
    const reused = await createWorktree({
      root,
      path: worktreePath(root, "r1", "fix"),
      branch: branchName("r1", "fix"),
      base: "ork/r1/lead",
      known: true,
    });
    expect(reused.reused).toBe(true);
    expect(sh(reused.path, "ls-files", "src/fix.ts")).toBe("src/fix.ts\n");
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

/**
 * A leader that writes a plan, delegates to `fix`, spawns one more, and checks
 * both children's files are in its checkout; children record whether they saw
 * the plan.
 */
const leading = () => {
  const seen: Record<string, boolean> = {};
  const executor: NodeExecutor = async context => {
    if (context.ownership === undefined) {
      seen[context.id] = existsSync(path.join(context.cwd, "plan.md"));
      write(context.cwd, `src/${context.id}.ts`, `${context.id}\n`);
      return { ok: true, output: { status: "pass", summary: "ok" } };
    }
    write(context.cwd, "plan.md", "# Plan\n");
    await context.ownership.delegate([{ child: "fix", brief: "fix" }]);
    await context.ownership.spawn([{ template: "fix", brief: "more" }]);
    seen["merged"] = ["src/fix.ts", "src/fix-2.ts"].every(f =>
      existsSync(path.join(context.cwd, f)),
    );
    return { ok: true, output: { status: "pass", summary: "led" } };
  };
  return { executor, seen };
};

describe("delegation in worktrees", () => {
  it("commits the leader's work, then merges each child into its checkout", async () => {
    const root = repo();
    const graph = compile(
      [
        "schemaVersion: 1",
        "name: owned",
        "nodes:",
        "  lead: { type: claude.leader, maxWorkers: 1 }",
        "  fix: { type: claude.worker, parent: lead }",
      ].join("\n"),
    );
    const { executor, seen } = leading();
    const { result, worktreeEvents } = await runIn(root, graph, executor);

    expect(result.status).toBe("succeeded");
    expect(seen).toEqual({ fix: true, "fix-2": true, merged: true });
    expect(worktreeEvents).toEqual([
      "lead created",
      "lead committed",
      "fix created",
      "fix committed",
      "fix merged",
      "fix-2 created",
      "fix-2 committed",
      "fix-2 merged",
      "fix removed",
      "fix-2 removed",
    ]);
    expect(sh(worktreePath(root, "r1", "lead"), "log", "--format=%s")).toMatch(
      /^ork: merge fix-2 into lead \(run r1\)\n/u,
    );
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

  it("keeps a detached worktree holding a commit no branch has", async () => {
    const root = repo();
    const place = path.join(path.dirname(root), `${path.basename(root)}-task`);
    sh(root, "worktree", "add", "--detach", place);
    write(place, "done.ts", "done\n");
    sh(place, "add", "-A");
    sh(place, "commit", "--quiet", "-m", "a tool.git commit");

    const items = await listOrkWorktrees(root, [
      { runId: "r1", nodeId: "lead", path: place },
    ]);
    expect(items.map(i => [i.branch, i.ahead, i.merged])).toEqual([
      [undefined, 1, false],
    ]);
    const steps = planClean(
      items,
      { merged: false },
      { branches: true, force: false },
    );
    expect(steps.map(s => [s.removeWorktree, s.skip])).toEqual([
      [false, "commits on no branch"],
    ]);
  });
});
