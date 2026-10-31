/**
 * @file Tests for agents: the catalog (user and project folders, links counted
 *   once, the more local agent winning), filling agent nodes when compiling
 *   (the node's own settings win, inline agents win, unknown agents fail), the
 *   role in the session, the run's record of it, and the registry's writes.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  type AgentCatalog,
  catalogAgent,
  compileWorkflow,
  createAgent,
  deleteAgent,
  type HumanChannel,
  loadAgents,
  type NodeExecutor,
  planNodeSession,
  type PlanResult,
  type RunEvent,
  startRun,
  updateAgent,
} from "../src/index.ts";

const temp = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const put = (file: string, text: string): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

const agentMd = (
  name: string,
  role: string,
  description = "Test agent.",
): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${role}\n`;

/** A project whose `.claude/agents` and `.opencode/agents` link to `.ai/agents`. */
const linkedProject = (): { root: string; home: string } => {
  const root = temp("ork-agents-");
  const home = temp("ork-home-");
  put(
    path.join(root, ".ai/agents/reviewer.md"),
    agentMd("reviewer", "Review."),
  );
  put(
    path.join(root, ".ai/agents/reviewer.agent.yaml"),
    "model: haiku\nisolation: readonly\n",
  );
  mkdirSync(path.join(root, ".claude"));
  mkdirSync(path.join(root, ".opencode"));
  symlinkSync("../.ai/agents", path.join(root, ".claude/agents"));
  symlinkSync("../.ai/agents", path.join(root, ".opencode/agents"));
  put(path.join(home, ".ork/agents/reviewer.md"), agentMd("reviewer", "Mine."));
  put(path.join(home, ".ork/agents/helper.md"), agentMd("helper", "Help."));
  put(path.join(root, ".ork/agents/broken.md"), agentMd("broken", "B."));
  put(
    path.join(root, ".ork/agents/broken.agent.yaml"),
    "isolation: sideways\n",
  );
  return { root, home };
};

const compile = (
  lines: string[],
  catalog?: AgentCatalog,
  workflowDir?: string,
) => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return compileWorkflow(parsed.workflow, {
    ...(catalog === undefined ? {} : { catalog }),
    ...(workflowDir === undefined ? {} : { workflowDir }),
  });
};

const graphOf = (result: ReturnType<typeof compile>) => {
  if (result.graph === null)
    throw new Error(JSON.stringify(result.diagnostics));
  return result.graph;
};

const specOf = (plan: PlanResult) => {
  if (!plan.ok) throw new Error(plan.error);
  return plan.spec;
};

const human: HumanChannel = {
  ask: () => Promise.resolve("keep"),
  permit: () => Promise.resolve({ allow: true }),
};

const executor: NodeExecutor = () =>
  Promise.resolve({ ok: true, output: { status: "pass", summary: "" } });

describe("the agent catalog", () => {
  it("reads the user's and the project's, links once, the local winning", () => {
    const { root, home } = linkedProject();
    const catalog = loadAgents({ projectRoot: root, home });
    expect(
      catalog.agents.map(a => [a.name, a.source, a.where, a.via, a.shadowedBy]),
    ).toEqual([
      ["helper", "user", "~/.ork/agents/helper.md", [], undefined],
      [
        "reviewer",
        "user",
        "~/.ork/agents/reviewer.md",
        [],
        ".ai/agents/reviewer.md",
      ],
      [
        "reviewer",
        "project",
        ".ai/agents/reviewer.md",
        [".opencode/agents", ".claude/agents"],
        undefined,
      ],
    ]);
    expect(catalogAgent(catalog, "reviewer")?.agent).toEqual({
      description: "Test agent.",
      instructions: "Review.",
      model: "haiku",
      isolation: "readonly",
    });
    expect(catalogAgent(catalog, "reviewer")?.hash).toMatch(/^[0-9a-f]{12}$/u);
    expect(catalog.diagnostics.map(d => d.message)).toEqual([
      expect.stringContaining(".ork/agents/broken.md is skipped"),
    ]);
  });
});

describe("agent nodes", () => {
  const { root, home } = linkedProject();
  const catalog = loadAgents({ projectRoot: root, home });

  it("take the agent's settings where they set none, and keep their own", () => {
    const graph = graphOf(
      compile(
        [
          "nodes:",
          "  a: { type: claude.worker, agent: reviewer, prompt: Review x., model: opus }",
          "  b: { type: claude.worker, agent: helper, prompt: Help. }",
        ],
        catalog,
      ),
    );
    expect(graph.workflow.nodes["a"]).toMatchObject({
      agent: "reviewer",
      model: "opus",
      isolation: "readonly",
    });
    expect(graph.agents.get("a")).toMatchObject({
      name: "reviewer",
      source: "project",
      where: ".ai/agents/reviewer.md",
    });
    expect(graph.agents.get("a")?.hash).toMatch(/^[0-9a-f]{12}$/u);
    expect(graph.agents.get("b")?.source).toBe("user");
    expect(Object.keys({ ...graph.workflow.agents }).toSorted()).toEqual([
      "helper",
      "reviewer",
    ]);
  });

  it("prefer the workflow's own agent, whose output fields the edges can read", () => {
    const graph = graphOf(
      compile(
        [
          "agents:",
          "  reviewer:",
          "    instructions: Inline.",
          "    output: { schema: { verdict: [approve, escalate] } }",
          "nodes:",
          "  a: { type: claude.worker, agent: reviewer }",
          "  b: { type: claude.worker, prompt: go }",
          "edges:",
          "  - { from: a, to: b, when: \"verdict == 'approve'\" }",
        ],
        catalog,
      ),
    );
    expect(graph.agents.get("a")?.source).toBe("workflow");
    expect(graph.workflow.nodes["a"]).not.toHaveProperty("isolation");
  });

  it("fail on an agent no one defines, naming the known ones", () => {
    const result = compile(
      ["nodes:", "  a: { type: claude.worker, agent: nobody }"],
      catalog,
    );
    expect(result.graph).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "agent.unknown",
        message:
          '"a" names agent "nobody", which is not defined; known: helper, reviewer',
        path: ["nodes", "a", "agent"],
      }),
    );
  });

  it("rebase an agent file's skill paths onto the workflow's folder", () => {
    const dir = temp("ork-rebase-");
    put(path.join(dir, ".ork/agents/x.md"), agentMd("x", "X."));
    put(path.join(dir, ".ork/agents/x.agent.yaml"), "skills: [./skills/s]\n");
    const graph = graphOf(
      compile(
        ["nodes:", "  a: { type: claude.worker, agent: x }"],
        loadAgents({ projectRoot: dir, home: temp("ork-home-") }),
        path.join(dir, ".ork/workflows"),
      ),
    );
    expect(graph.workflow.nodes["a"]).toMatchObject({
      skills: ["../agents/skills/s"],
    });
  });

  it("carry the agent's role into the session, after the shared layers", () => {
    const graph = graphOf(
      compile(
        [
          "nodes:",
          "  a: { type: claude.worker, agent: reviewer, prompt: Go. }",
        ],
        catalog,
      ),
    );
    const spec = specOf(
      planNodeSession(graph.workflow, "a", {
        cwd: root,
        inputs: {},
        inPlace: true,
        home,
      }),
    );
    expect(spec.systemAppend).toContain("# Your role: reviewer\n\nReview.");
    expect(spec.model).toBe("haiku");
    expect(spec.prompt).toBe("Go.");
  });

  it("are recorded with their agent when they start", async () => {
    const graph = graphOf(
      compile(
        [
          "nodes:",
          "  a: { type: claude.worker, agent: reviewer, prompt: Go. }",
        ],
        catalog,
      ),
    );
    const events: RunEvent[] = [];
    await startRun({
      graph,
      inputs: {},
      cwd: root,
      executors: { "claude.worker": executor },
      human,
      onEvent: event => {
        events.push(event);
      },
    }).done;
    expect(events.find(e => e.type === "node.started")).toMatchObject({
      agent: {
        name: "reviewer",
        source: "project",
        where: ".ai/agents/reviewer.md",
      },
    });
  });
});

describe("the agent registry's writes", () => {
  it("create, update and delete agents in Ork's folders only", () => {
    const root = temp("ork-write-");
    const options = { scope: "project", projectRoot: root } as const;
    const md = path.join(root, ".ork/agents/approver.md");
    const sidecar = path.join(root, ".ork/agents/approver.agent.yaml");

    expect(
      createAgent(
        "approver",
        { instructions: "Approve.", model: "opus" },
        options,
      ),
    ).toEqual({
      ok: true,
      files: [md, sidecar],
    });
    expect(createAgent("approver", {}, options)).toMatchObject({ ok: false });
    expect(
      updateAgent("approver", { instructions: "Approve." }, options),
    ).toEqual({
      ok: true,
      files: [md],
    });
    expect(existsSync(sidecar)).toBe(false);
    expect(updateAgent("nobody", {}, options)).toMatchObject({ ok: false });
    expect(createAgent("Bad Name", {}, options)).toMatchObject({ ok: false });
    expect(deleteAgent("approver", options)).toEqual({ ok: true, files: [md] });
    expect(deleteAgent("approver", options)).toMatchObject({ ok: false });

    const home = temp("ork-home-");
    expect(createAgent("mine", {}, { scope: "user", home })).toEqual({
      ok: true,
      files: [path.join(home, ".ork/agents/mine.md")],
    });
  });
});
