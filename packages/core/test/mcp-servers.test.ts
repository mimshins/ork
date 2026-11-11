/**
 * @file Tests for the MCP servers a Claude node names (`mcp:`, ADR-067): the
 *   compiler's checks against `.mcp.json`, and how the planner resolves a
 *   node's list against the workflow's and the project's defaults and adds its
 *   allow rules.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow, type Project, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  mcpFileOptions,
  type McpOptions,
  planNodeSession,
} from "../src/index.ts";

const workflowOf = (...lines: string[]): Workflow => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const projectWith = (file: string): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-mcp-"));
  writeFileSync(path.join(root, ".mcp.json"), file);
  return root;
};

const fileWith = (servers: Record<string, unknown>) =>
  projectWith(JSON.stringify({ mcpServers: servers }));

const issues = (
  workflow: Workflow,
  options: McpOptions & { project?: Project },
) =>
  compileWorkflow(workflow, options).diagnostics.filter(d =>
    d.code.startsWith("mcp."),
  );

const worker = (mcp: string) =>
  workflowOf(
    "nodes:",
    `  design: { type: agent.worker, prompt: Go, isolation: shared, mcp: ${mcp} }`,
  );

/** The message for a name, with a `.mcp.json` that doesn't parse. */
const unreadableMessage = (): string => {
  const root = projectWith('{ "mcpServers": { "secret-value" ');
  return issues(worker("[browser]"), mcpFileOptions(root))[0]?.message ?? "";
};

describe("the servers a node names", () => {
  it("are checked only when the caller gives the file's names", () => {
    expect(issues(worker("[browser]"), {})).toEqual([]);
  });

  it("pass when `.mcp.json` has them", () => {
    const root = fileWith({ browser: { command: "npx" } });
    expect(issues(worker("[browser]"), mcpFileOptions(root))).toEqual([]);
  });

  it("are an error naming the node, the server and the file's servers", () => {
    const root = fileWith({ a: { command: "x" }, b: { url: "http://y" } });
    expect(issues(worker("[browser]"), mcpFileOptions(root))).toEqual([
      {
        severity: "error",
        code: "mcp.unknown",
        message:
          "`design`: no MCP server `browser` in .mcp.json, which has a, b",
        path: ["nodes", "design", "mcp", 0],
      },
    ]);
  });

  it("are an error when there is no `.mcp.json`", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ork-mcp-"));
    expect(issues(worker("[browser]"), mcpFileOptions(root))[0]?.message).toBe(
      "`design`: no MCP server `browser`: there is no .mcp.json",
    );
  });

  it("are an error when `.mcp.json` is not valid JSON, without quoting it", () => {
    const message = unreadableMessage();
    expect(message).toContain("it is not valid JSON");
    expect(message).not.toContain("secret-value");
  });

  it("can't be Ork's own server", () => {
    const root = fileWith({ ork: { command: "x" } });
    expect(issues(worker("[ork]"), mcpFileOptions(root))).toMatchObject([
      {
        code: "mcp.reserved",
        message: "`design`: `ork` is Ork's own server, name another",
      },
    ]);
  });

  it.each([
    ["not an object", { browser: "npx" }, "it is not an object"],
    ["neither program nor url", { browser: { args: [] } }, "neither a command"],
    [
      "a value that isn't text",
      { browser: { command: "x", args: [1] } },
      "args",
    ],
    [
      "args that isn't a list",
      { browser: { command: "x", args: "-y" } },
      "args",
    ],
    [
      "env that isn't an object",
      { browser: { command: "x", env: ["A=1"] } },
      "env",
    ],
    [
      "headers that aren't an object",
      { browser: { url: "u", headers: "h" } },
      "headers",
    ],
  ])("are an error when malformed: %s", (_case, servers, reason) => {
    const found = issues(
      worker("[browser]"),
      mcpFileOptions(fileWith(servers)),
    );
    expect(found).toMatchObject([{ code: "mcp.malformed" }]);
    expect(found[0]?.message).toContain(reason);
  });

  it("through `defaults` are checked for each node that takes them", () => {
    const workflow = workflowOf(
      "defaults: { mcp: [browser] }",
      "nodes:",
      "  a: { type: agent.worker, prompt: Go, isolation: shared }",
      "  b: { type: agent.worker, prompt: Go, isolation: shared, mcp: [] }",
    );
    expect(issues(workflow, mcpFileOptions(fileWith({})))).toMatchObject([
      {
        code: "mcp.unknown",
        message: "`a`: no MCP server `browser` in .mcp.json, which has none",
        path: ["defaults", "mcp", 0],
      },
    ]);
  });
});

const planned = (workflow: Workflow, id: string) => {
  const plan = planNodeSession(workflow, id, {
    cwd: process.cwd(),
    inputs: {},
    inPlace: true,
  });
  if (!plan.ok) throw new Error(plan.error);
  return plan;
};

describe("planning a node's servers", () => {
  it("takes the node's list over the defaults, as a whole", () => {
    const workflow = workflowOf(
      "defaults: { mcp: [a, b] }",
      "nodes:",
      "  own: { type: agent.worker, prompt: Go, mcp: [c] }",
      "  off: { type: agent.worker, prompt: Go, mcp: [] }",
      "  rest: { type: agent.worker, prompt: Go }",
    );
    expect(planned(workflow, "own").mcp).toEqual(["c"]);
    expect(planned(workflow, "off").mcp).toEqual([]);
    expect(planned(workflow, "rest").mcp).toEqual(["a", "b"]);
  });

  it("names no server for a node with no `mcp` and no default", () => {
    const plan = planned(
      workflowOf("nodes:", "  n: { type: agent.worker, prompt: Go }"),
      "n",
    );
    expect(plan.mcp).toEqual([]);
    expect(plan.spec.mcpServers).toBeUndefined();
    expect(plan.spec.tools.allow).toEqual([]);
  });

  it("allows the named servers' tools, and a deny rule still stands", () => {
    const { spec } = planned(
      workflowOf(
        "nodes:",
        "  n: { type: agent.worker, prompt: Go, mcp: [chrome-devtools], tools: { deny: [mcp__chrome-devtools__navigate_page] } }",
      ),
      "n",
    );
    expect(spec.tools.allow).toEqual(["mcp__chrome-devtools"]);
    expect(spec.tools.deny).toEqual(["mcp__chrome-devtools__navigate_page"]);
  });

  it("writes a server name's other characters as `_` in its allow rule", () => {
    const { spec } = planned(
      workflowOf(
        "nodes:",
        "  n: { type: agent.worker, prompt: Go, mcp: [my.server] }",
      ),
      "n",
    );
    expect(spec.tools.allow).toEqual(["mcp__my_server"]);
  });

  it("takes workflow defaults over the project's", () => {
    const workflow = workflowOf(
      "defaults: { mcp: [own] }",
      "nodes:",
      "  n: { type: agent.worker, prompt: Go, isolation: shared }",
    );
    const { graph } = compileWorkflow(workflow, {
      project: {
        schemaVersion: 1,
        defaults: { mcp: ["theirs"], model: "haiku" },
      },
    });
    expect(graph?.workflow.defaults).toEqual({ mcp: ["own"], model: "haiku" });
  });

  it("uses the project's when the workflow's has none", () => {
    const workflow = workflowOf(
      "nodes:",
      "  n: { type: agent.worker, prompt: Go, isolation: shared }",
    );
    const { graph } = compileWorkflow(workflow, {
      project: { schemaVersion: 1, defaults: { mcp: ["theirs"] } },
    });
    expect(graph?.workflow.defaults).toEqual({ mcp: ["theirs"] });
  });
});
