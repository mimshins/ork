/**
 * @file Tests for project rules: `.ork/project.yaml` under a workflow (the
 *   workflow's own rules, defaults and context win; permissions add up), the
 *   checks on git rules, and the git rules at work in real worktrees: names and
 *   base from templates, `commit: never` with changes handed over as patches,
 *   `merge: never`, and a branch the run did not create left alone.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseWorkflow, type Project } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  applyProject,
  checkRules,
  compileWorkflow,
  createdWorktrees,
  gitRulesOf,
  listOrkWorktrees,
  loadProject,
  type NodeExecutor,
  planNodeSession,
  type PlanResult,
  resolveBase,
  type RunEvent,
} from "../src/index.ts";
import { compile, repo, runIn, sh, working } from "./fixtures/git.ts";

const workflowOf = (lines: string[]) => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const specOf = (plan: PlanResult) => {
  if (!plan.ok) throw new Error(plan.error);
  return plan.spec;
};

const messages = (lines: string[]) =>
  checkRules(workflowOf(lines)).map(d => `${d.severity}: ${d.message}`);

/** Where a node worked; it must have run. */
const at = (cwds: Record<string, string>, id: string): string => {
  const cwd = cwds[id];
  if (cwd === undefined) throw new Error(`${id} did not run`);
  return cwd;
};

const PROJECT: Project = {
  schemaVersion: 1,
  git: { commit: "never", branch: "task/{node}" },
  permissions: { deny: ["Bash(git push *)"], allow: ["Read"] },
  defaults: { model: "haiku", budgetUsd: 1 },
  context: ["docs/rules.md"],
};

describe("project rules under a workflow", () => {
  it("let the workflow win, add permissions up, and put context first", () => {
    const workflow = applyProject(
      workflowOf([
        "defaults: { model: opus }",
        "rules:",
        "  git: { branch: 'feat/{node}' }",
        "  permissions: { deny: ['Bash(rm *)'] }",
        "layers: { context: [./house.md] }",
        "nodes:",
        "  a: { type: claude.worker, prompt: go, tools: { deny: [WebFetch] } }",
      ]),
      {
        project: PROJECT,
        projectRoot: "/p",
        workflowDir: "/p/.ork/workflows",
      },
    );
    expect(workflow.defaults).toEqual({ model: "opus", budgetUsd: 1 });
    expect(workflow.rules).toEqual({
      git: { commit: "never", branch: "feat/{node}" },
      permissions: {
        allow: ["Read"],
        deny: ["Bash(git push *)", "Bash(rm *)"],
      },
    });
    expect(workflow.layers?.context).toEqual([
      "../../docs/rules.md",
      "./house.md",
    ]);
    const spec = specOf(
      planNodeSession({ ...workflow, layers: {} }, "a", {
        cwd: "/p",
        inputs: {},
        inPlace: true,
      }),
    );
    expect(spec.tools).toEqual({
      allow: ["Read"],
      deny: ["Bash(git push *)", "Bash(rm *)", "WebFetch"],
    });
  });

  it("are checked: placeholders, unique names, and merge against commit", () => {
    const two = [
      "inputs: { slug: { type: string } }",
      "nodes:",
      "  a: { type: claude.worker }",
      "  b: { type: claude.worker }",
    ];
    expect(
      messages([
        "rules:",
        "  git: { commit: never, merge: auto, worktrees: '../x/{inputs.nope}-{when}' }",
        ...two,
      ]),
    ).toEqual([
      "error: merge: auto needs commits; with commit: never use merge: patch or never",
      "error: git.worktrees: {inputs.nope} names no input of this workflow",
      "error: git.worktrees: {when} is not a placeholder; use {run}, {node}, {clone} or {inputs.<name>}",
      "error: git.worktrees needs {node}: this workflow can have more than one worktree in a run",
    ]);
    expect(
      messages(["rules:", "  git: { branch: 'task/{inputs.slug}' }", ...two]),
    ).toEqual([
      "error: git.branch needs {node}: this workflow can have more than one worktree in a run",
    ]);
    expect(
      messages([
        "inputs: { slug: { type: string } }",
        "rules:",
        "  git: { branch: 'task/{inputs.slug}', worktrees: '/tmp/{node}' }",
        "nodes:",
        "  a: { type: claude.worker }",
      ]),
    ).toEqual([
      "error: git.worktrees is relative to the clone, beside it (e.g. ../{clone}-worktrees/{node})",
      "warning: git.worktrees has no {run}: a second run stops while the first run's worktree exists",
      "warning: git.branch has no {run}: a second run stops while the first run's branch exists",
    ]);
  });

  it("report a broken project file where it is broken", () => {
    const root = repo();
    mkdirSync(path.join(root, ".ork"), { recursive: true });
    writeFileSync(
      path.join(root, ".ork/project.yaml"),
      "schemaVersion: 1\ngit:\n  commit: sometimes\n",
    );
    expect(loadProject(root).diagnostics.map(d => d.message)).toEqual([
      expect.stringMatching(/^\.ork\/project\.yaml:3:\d+: /u),
    ]);
    const compiled = compileWorkflow(
      workflowOf(["nodes:", "  a: { type: claude.worker }"]),
      { project: PROJECT },
    );
    expect(compiled.graph?.workflow.defaults?.model).toBe("haiku");
  });
});

const TEAM = (rules: string[]) =>
  compile(
    [
      "schemaVersion: 1",
      "name: team",
      "inputs: { slug: { type: string } }",
      ...rules,
      "nodes:",
      "  lead: { type: claude.leader }",
      "  fix: { type: claude.worker, parent: lead }",
      "edges:",
      "  - lead -> fix",
    ].join("\n"),
  );

/** Like `working`, and records whether `fix` saw the lead's file. */
const team = () => {
  const { executor, cwds } = working({
    lead: { files: { "src/lead.ts": "lead\n" } },
    fix: { files: { "src/fix.ts": "fix\n" } },
  });
  const seen: Record<string, boolean> = {};
  const recording: NodeExecutor = context => {
    seen[context.id] = existsSync(path.join(context.cwd, "src/lead.ts"));
    return executor(context);
  };
  return { executor: recording, cwds, seen };
};

/** What `ork worktrees` lists after one run with these events. */
const listed = async (root: string, events: readonly RunEvent[]) => {
  const store = {
    runs: () => [
      {
        id: "r1",
        workflow: "team",
        file: "",
        project: root,
        status: "succeeded" as const,
        pid: 0,
        startedAt: "",
        costUsd: 0,
      },
    ],
    events: () =>
      events.map((event, i) => ({ runId: "r1", seq: i + 1, at: "", event })),
  };
  return (await listOrkWorktrees(root, createdWorktrees(store, root))).map(
    w => [
      w.branch,
      w.nodeId,
      w.path === null ? "no worktree" : "worktree",
      w.dirty,
    ],
  );
};

const status = (cwd: string) => sh(cwd, "status", "--porcelain").trim();

describe("git rules at work", () => {
  it("commit: never leaves every change uncommitted, and hands it over as a patch", async () => {
    const root = repo();
    const head = sh(root, "rev-parse", "HEAD");
    const { executor, cwds, seen } = team();
    const { result, worktreeEvents, events } = await runIn(
      root,
      TEAM(["rules: { git: { commit: never } }"]),
      executor,
    );
    const lead = at(cwds, "lead");

    expect(result.status).toBe("succeeded");
    expect(worktreeEvents).toEqual([
      "lead created",
      "fix created",
      "fix merged",
      "fix removed",
    ]);
    // fix started from the lead's uncommitted work; its own came back.
    expect(seen).toEqual({ lead: false, fix: true });
    expect(status(lead)).toBe("A  src/lead.ts\n?? src/fix.ts");
    expect(sh(lead, "rev-parse", "HEAD")).toBe(head);
    expect(sh(root, "branch", "--format=%(refname:short)")).toBe("main\n");
    expect(result.worktrees).toEqual([
      { id: "lead", path: lead, reason: "the run's result, uncommitted" },
    ]);
    expect(result.nodes.find(n => n.id === "lead")?.output).toMatchObject({
      worktree: lead,
    });
    expect(result.nodes.find(n => n.id === "lead")?.output).not.toHaveProperty(
      "branch",
    );
    expect(await listed(root, events)).toEqual([
      [undefined, "lead", "worktree", true],
    ]);
  });

  it("names branches and worktrees from templates, from the base", async () => {
    const root = repo();
    sh(root, "switch", "-q", "-c", "release");
    writeFileSync(path.join(root, "RELEASE"), "1\n");
    sh(root, "add", "RELEASE");
    sh(root, "commit", "-q", "-m", "release");
    sh(root, "switch", "-q", "main");
    const { executor, cwds } = team();
    const { result, events } = await runIn(
      root,
      TEAM([
        "rules:",
        "  git:",
        "    base: release",
        "    branch: 'task/{inputs.slug}/{node}'",
        "    worktrees: '../{clone}-tasks/{inputs.slug}-{node}'",
      ]),
      executor,
      undefined,
      { slug: "login" },
    );
    const lead = path.join(path.dirname(root), "app-tasks", "login-lead");

    expect(result.status).toBe("succeeded");
    expect(cwds["lead"]).toBe(lead);
    expect(existsSync(path.join(lead, "RELEASE"))).toBe(true);
    expect(sh(lead, "branch", "--show-current")).toBe("task/login/lead\n");
    expect(sh(lead, "ls-files", "src")).toBe(
      "src/app.ts\nsrc/fix.ts\nsrc/lead.ts\n",
    );
    // Listed by their recorded names, though they are not under ork/.
    expect(await listed(root, events)).toEqual([
      ["task/login/lead", "lead", "worktree", false],
      ["task/login/fix", "fix", "no worktree", false],
    ]);
  });

  it("merge: never keeps each child's work in its own worktree", async () => {
    const root = repo();
    const { executor, cwds } = team();
    const { result } = await runIn(
      root,
      TEAM(["rules: { git: { merge: never } }"]),
      executor,
    );
    expect(result.status).toBe("succeeded");
    expect(sh(at(cwds, "lead"), "ls-files", "src")).toBe(
      "src/app.ts\nsrc/lead.ts\n",
    );
    expect(result.worktrees.map(w => [w.id, w.reason])).toEqual([
      ["lead", "the run's result"],
      ["fix", "kept for its owner (merge: never)"],
    ]);
  });

  it("refuses names git would read as options", async () => {
    const root = repo();
    const { executor } = team();
    const { result } = await runIn(
      root,
      TEAM(["rules: { git: { branch: '{inputs.slug}/{node}' } }"]),
      executor,
      undefined,
      { slug: "--orphan" },
    );
    expect(result.nodes.find(n => n.id === "lead")?.error).toContain(
      'gives lead the branch "--orphan/lead", which is not a valid branch name',
    );
    await expect(
      resolveBase(
        root,
        gitRulesOf(
          workflowOf([
            "rules: { git: { base: '{inputs.slug}' } }",
            "inputs: { slug: { type: string } }",
            "nodes:",
            "  a: { type: claude.worker }",
          ]),
        ),
        { slug: "--all" },
      ),
    ).rejects.toThrow("git.base is --all, which is not a commit here");
  });

  it("never takes over a branch the run did not create", async () => {
    const root = repo();
    sh(root, "branch", "task/lead");
    const { executor } = team();
    const { result } = await runIn(
      root,
      TEAM(["rules: { git: { branch: 'task/{node}' } }"]),
      executor,
    );
    expect(result.status).toBe("failed");
    expect(result.nodes.find(n => n.id === "lead")?.error).toContain(
      "branch task/lead already exists, and this run did not create it",
    );
  });
});
