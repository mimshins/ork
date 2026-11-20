/**
 * @file Tests for project rules: `.ork/project.yaml` under a workflow (the
 *   workflow's own rules, defaults and context win; permissions add up), the
 *   checks on git rules, and the git rules at work in real worktrees: names and
 *   base from templates, `commit: never` with changes handed over as patches,
 *   `merge: never`, and a branch the run did not create left alone.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseWorkflow, type Project, ProjectSchema } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  applyProject,
  capsHere,
  checkRules,
  compileWorkflow,
  createdWorktrees,
  gitRulesOf,
  inRepoPlace,
  listOrkWorktrees,
  loadProject,
  machineRulesOf,
  type NodeExecutor,
  planNodeSession,
  type PlanResult,
  resolveBase,
  resolvePractices,
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

const parse = (git: object) =>
  ProjectSchema.safeParse({ schemaVersion: 1, git }).success;

/** `unlisted` of nodes r, w, n and m, with the project under the workflow. */
const unlisted = (lines: string[], project?: Project) => {
  const workflow = applyProject(
    workflowOf(lines),
    project === undefined ? {} : { project },
  );
  return ["r", "w", "n", "m"].map(
    id =>
      specOf(
        planNodeSession(workflow, id, { cwd: "/p", inputs: {}, inPlace: true }),
      ).tools.unlisted,
  );
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
        "  a: { type: agent.worker, prompt: go, tools: { deny: [WebFetch] } }",
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
      deny: [
        "Bash(git push *)",
        "Bash(rm *)",
        "WebFetch",
        "Grep",
        "Glob",
        "AskUserQuestion",
      ],
    });
  });

  it("let a workflow's sessions rule win over the project's, and leave it off by default", () => {
    const nodes = ["nodes:", "  a: { type: agent.worker, prompt: go }"];
    const effective = (lines: string[], project: Project) =>
      applyProject(workflowOf([...lines, ...nodes]), { project }).rules
        ?.sessions;
    const project: Project = {
      schemaVersion: 1,
      sessions: { freshOver: 100000 },
    };
    expect(effective([], project)).toEqual({ freshOver: 100000 });
    expect(
      effective(["rules: { sessions: { freshOver: never } }"], project),
    ).toEqual({ freshOver: "never" });
    expect(effective([], { schemaVersion: 1 })).toBeUndefined();
  });

  it("fetch a remote base and read the checkout by default, and take the project's fetch and readonly", () => {
    const nodes = ["nodes:", "  a: { type: agent.worker, prompt: go }"];
    expect(gitRulesOf(workflowOf(nodes))).toMatchObject({
      fetch: "auto",
      readonly: "checkout",
    });
    const project: Project = {
      schemaVersion: 1,
      git: { fetch: "never", readonly: "base" },
    };
    expect(
      gitRulesOf(applyProject(workflowOf(nodes), { project })),
    ).toMatchObject({ fetch: "never", readonly: "base" });
    expect(
      gitRulesOf(
        applyProject(
          workflowOf(["rules: { git: { fetch: auto } }", ...nodes]),
          { project },
        ),
      ),
    ).toMatchObject({ fetch: "auto", readonly: "base" });
  });

  it("reject an unknown git.fetch or git.readonly value", () => {
    expect(parse({ fetch: "never", readonly: "base" })).toBe(true);
    expect(parse({ fetch: "always" })).toBe(false);
    expect(parse({ readonly: "head" })).toBe(false);
  });

  it("deny the heavy commands to a node with verify:, and only to it", () => {
    const workflow = applyProject(
      workflowOf([
        "nodes:",
        "  v: { type: agent.worker, prompt: go, verify: { command: pnpm check } }",
        "  w: { type: agent.worker, prompt: go, tools: { deny: [WebFetch] } }",
      ]),
      {
        project: {
          schemaVersion: 1,
          permissions: { deny: ["Bash(git push *)"] },
          heavy: ["pnpm check", "pnpm test", "vitest run"],
        },
      },
    );
    const plan = (id: string) =>
      specOf(
        planNodeSession(workflow, id, { cwd: "/p", inputs: {}, inPlace: true }),
      );
    const verified = plan("v");
    expect(verified.tools.deny).toEqual([
      "Bash(git push *)",
      "Bash(pnpm check)",
      "Bash(pnpm test)",
      "Bash(vitest run)",
      "Grep",
      "Glob",
      "AskUserQuestion",
    ]);
    expect(verified.systemAppend).toContain("Ork runs the full check");
    const plain = plan("w");
    expect(plain.tools.deny).toEqual([
      "Bash(git push *)",
      "WebFetch",
      "Grep",
      "Glob",
      "AskUserQuestion",
    ]);
  });

  it("tell a verify: node to run its check when the project lets it", () => {
    const workflow = applyProject(
      workflowOf([
        "nodes:",
        "  v: { type: agent.worker, prompt: go, verify: { command: pnpm check:changed } }",
      ]),
      { project: { schemaVersion: 1, heavy: ["pnpm check"] } },
    );
    const spec = specOf(
      planNodeSession(workflow, "v", { cwd: "/p", inputs: {}, inPlace: true }),
    );
    expect(spec.tools.deny).toContain("Bash(pnpm check)");
    expect(spec.systemAppend).toContain("so run it yourself first if you can");
  });

  it("default to no heavy commands and low priority", () => {
    expect(machineRulesOf()).toEqual({ heavy: [], priority: "low" });
    expect(
      machineRulesOf({ ...PROJECT, heavy: ["pnpm check"], priority: "normal" }),
    ).toEqual({ heavy: ["pnpm check"], priority: "normal" });
  });

  it("keep a project's practice when the workflow sets only the other", () => {
    const workflow = applyProject(
      workflowOf([
        "defaults: { practices: { ponytail: ultra } }",
        "nodes:",
        "  a: { type: agent.worker, prompt: go }",
      ]),
      { project: { ...PROJECT, defaults: { practices: { caveman: false } } } },
    );
    expect(resolvePractices(workflow, "a")).toEqual({
      caveman: false,
      ponytail: "ultra",
      quiet: true,
    });
  });

  it("let a workflow turn a project's practice back on", () => {
    const workflow = applyProject(
      workflowOf([
        "defaults: { practices: { caveman: true } }",
        "nodes:",
        "  a: { type: agent.worker, prompt: go }",
      ]),
      { project: { ...PROJECT, defaults: { practices: { caveman: false } } } },
    );
    expect(resolvePractices(workflow, "a").caveman).toBe(true);
  });

  it("let a readonly node read git, and write nothing", () => {
    const workflow = workflowOf([
      "nodes:",
      "  r: { type: agent.worker, prompt: go, isolation: readonly }",
    ]);
    const spec = specOf(
      planNodeSession(workflow, "r", { cwd: "/p", inputs: {}, inPlace: true }),
    );
    expect(spec.tools.deny).toEqual([
      "Write",
      "Edit",
      "NotebookEdit",
      "Grep",
      "Glob",
      "AskUserQuestion",
    ]);
    // extract shows a diff, a commit and the log (RFC-025).
    expect(spec.tools.allow).toEqual([
      "Bash(git status)",
      "Bash(git status *)",
      "Bash(git -C * status *)",
    ]);
    expect(spec.reading).toBe("extract-only");
  });

  it("resolve unlisted: node over workflow over project, refuse by default on readonly", () => {
    const nodes = [
      "nodes:",
      "  r: { type: agent.worker, prompt: go, isolation: readonly }",
      "  w: { type: agent.worker, prompt: go }",
      "  n: { type: agent.worker, prompt: go, isolation: readonly, tools: { unlisted: ask } }",
      "  m: { type: agent.worker, prompt: go, tools: { unlisted: refuse } }",
    ];
    expect(unlisted(nodes)).toEqual(["refuse", undefined, "ask", "refuse"]);
    const projectAsks: Project = {
      schemaVersion: 1,
      permissions: { unlisted: "ask" },
    };
    expect(unlisted(nodes, projectAsks)).toEqual([
      "ask",
      "ask",
      "ask",
      "refuse",
    ]);
    expect(
      unlisted(
        ["rules: { permissions: { unlisted: refuse } }", ...nodes],
        projectAsks,
      ),
    ).toEqual(["refuse", "refuse", "ask", "refuse"]);
  });

  it("take unlisted as one value in the rules merge, not added up", () => {
    const merged = applyProject(
      workflowOf([
        "rules: { permissions: { unlisted: refuse, allow: ['Bash(ls *)'] } }",
        "nodes:",
        "  a: { type: agent.worker, prompt: go }",
      ]),
      {
        project: {
          ...PROJECT,
          permissions: { allow: ["Read"], unlisted: "ask" },
        },
      },
    );
    expect(merged.rules?.permissions).toEqual({
      allow: ["Read", "Bash(ls *)"],
      unlisted: "refuse",
    });
  });

  it("withhold Grep and Glob, and refuse a non-editing node's text Reads (RFC-025)", () => {
    const workflow = workflowOf([
      "nodes:",
      "  r: { type: agent.worker, prompt: go, isolation: readonly }",
      "  w: { type: agent.worker, prompt: go }",
      "  g: { type: agent.worker, prompt: go, tools: { only: [Read, Grep] } }",
    ]);
    const plan = (id: string) =>
      specOf(
        planNodeSession(workflow, id, { cwd: "/p", inputs: {}, inPlace: true }),
      );
    expect(plan("r").tools.deny).toEqual([
      "Write",
      "Edit",
      "NotebookEdit",
      "Grep",
      "Glob",
      "AskUserQuestion",
    ]);
    expect([plan("r"), plan("w"), plan("g")].map(spec => spec.reading)).toEqual(
      ["extract-only", "extract", "extract-only"],
    );
    // A node that names Grep keeps it.
    expect(plan("g").tools.deny).toEqual(["Glob", "AskUserQuestion"]);
  });

  it("withhold AskUserQuestion unless the node names it, whatever the reading rule", () => {
    const workflow = workflowOf([
      "rules: { reading: open }",
      "nodes:",
      "  w: { type: agent.worker, prompt: go }",
      "  a: { type: agent.worker, prompt: go, tools: { allow: [AskUserQuestion] } }",
      "  o: { type: agent.worker, prompt: go, tools: { only: [Read, AskUserQuestion] } }",
    ]);
    const deny = (id: string) =>
      specOf(
        planNodeSession(workflow, id, { cwd: "/p", inputs: {}, inPlace: true }),
      ).tools.deny;
    expect([deny("w"), deny("a"), deny("o")]).toEqual([
      ["AskUserQuestion"],
      [],
      [],
    ]);
  });

  it("deny under agents: isolate the agents of the workflow's other nodes", () => {
    const nodes = [
      "agents:",
      "  documenter: { instructions: Write docs. }",
      "  implementer: { instructions: Build. }",
      "  reviewer: { instructions: Review. }",
      "nodes:",
      "  d: { type: agent.worker, prompt: go, agent: documenter }",
      "  i: { type: agent.worker, prompt: go, agent: implementer }",
      "  r: { type: agent.worker, prompt: go, agent: reviewer }",
      "  t: { type: agent.subagent, parent: i, description: Reviews., agent: reviewer }",
    ];
    const agentDenies = (lines: string[], id: string) =>
      specOf(
        planNodeSession(workflowOf([...lines, ...nodes]), id, {
          cwd: "/p",
          inputs: {},
          inPlace: true,
        }),
      ).tools.deny.filter(rule => /^(?:Agent|Task)\(/u.test(rule));
    const isolate = ["rules: { agents: isolate }"];
    expect(agentDenies(isolate, "d")).toEqual([
      "Agent(implementer)",
      "Task(implementer)",
      "Agent(reviewer)",
      "Task(reviewer)",
    ]);
    // Never its own agent, nor its own sub-agent child's.
    expect(agentDenies(isolate, "i")).toEqual([
      "Agent(documenter)",
      "Task(documenter)",
    ]);
    expect(agentDenies(isolate, "r")).toEqual([
      "Agent(documenter)",
      "Task(documenter)",
      "Agent(implementer)",
      "Task(implementer)",
    ]);
    expect(agentDenies(["rules: { agents: open }"], "d")).toEqual([]);
    expect(agentDenies([], "d")).toEqual([]);
  });

  it("let a workflow's agents rule win over the project's", () => {
    const nodes = ["nodes:", "  a: { type: agent.worker, prompt: go }"];
    const effective = (lines: string[], project: Project) =>
      applyProject(workflowOf([...lines, ...nodes]), { project }).rules?.agents;
    const project: Project = { schemaVersion: 1, agents: "isolate" };
    expect(effective([], project)).toBe("isolate");
    expect(effective(["rules: { agents: open }"], project)).toBe("open");
    expect(effective([], { schemaVersion: 1 })).toBeUndefined();
  });

  it("let a readonly node read git through the shell under reading: open", () => {
    const workflow = workflowOf([
      "rules: { reading: open }",
      "nodes:",
      "  r: { type: agent.worker, prompt: go, isolation: readonly }",
    ]);
    const spec = specOf(
      planNodeSession(workflow, "r", { cwd: "/p", inputs: {}, inPlace: true }),
    );
    expect(spec.tools.allow).toContain("Bash(git diff *)");
    expect(spec.tools.allow).toContain("Bash(git -C * log *)");
    expect(spec.reading).toBe("open");
  });

  it("give a node's session its sub-agents, with the tool to reach them", () => {
    const workflow = workflowOf([
      "inputs: { lang: { type: string } }",
      "nodes:",
      "  w: { type: agent.worker, prompt: go, tools: { only: [Read] } }",
      "  t:",
      "    type: agent.subagent",
      "    parent: w",
      "    description: Writes the tests.",
      "    prompt: Write tests in {{inputs.lang}}.",
      "    model: haiku",
    ]);
    const spec = specOf(
      planNodeSession(workflow, "w", {
        cwd: "/p",
        inputs: { lang: "Go" },
        inPlace: true,
      }),
    );
    expect(spec.agents).toEqual({
      t: {
        description: "Writes the tests.",
        prompt: "Write tests in Go.",
        model: "haiku",
      },
    });
    expect(spec.tools.only).toEqual(["Read", "Agent"]);
  });

  it("are checked: placeholders, unique names, and merge against commit", () => {
    const two = [
      "inputs: { slug: { type: string } }",
      "nodes:",
      "  a: { type: agent.worker }",
      "  b: { type: agent.worker }",
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
        "  a: { type: agent.worker }",
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
    const [found] = loadProject(root).diagnostics;
    expect([found?.file, found?.line, found?.column, found?.path]).toEqual([
      ".ork/project.yaml",
      3,
      11,
      [],
    ]);
    expect(found?.message).not.toContain("project.yaml");
    // `ork usage` and a run's refusal keep the place in their text.
    expect(capsHere(root, inRepoPlace(root)).problems).toEqual([
      expect.stringMatching(/^\.ork\/project\.yaml:3:\d+: /u),
    ]);
    const compiled = compileWorkflow(
      workflowOf(["nodes:", "  a: { type: agent.worker }"]),
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
      "  lead: { type: agent.leader }",
      "  fix: { type: agent.worker, parent: lead }",
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
        depth: 0,
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
      "gives `lead` the branch `--orphan/lead`, which is not a valid branch name",
    );
    await expect(
      resolveBase(
        root,
        gitRulesOf(
          workflowOf([
            "rules: { git: { base: '{inputs.slug}' } }",
            "inputs: { slug: { type: string } }",
            "nodes:",
            "  a: { type: agent.worker }",
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
