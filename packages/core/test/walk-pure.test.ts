/**
 * @file Holds the walk to what it promises (RFC-009): it writes no file, starts
 *   no process and opens no socket, because `startRun` given no workspace
 *   touches nothing. It replaces the real modules' functions, not a mock of
 *   them, so no way of importing them gets around it.
 */

import childProcess, { spawnSync } from "node:child_process";
import fs, { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  type CompiledGraph,
  compileWorkflow,
  walkWorkflow,
} from "../src/index.ts";

const FILE_WRITES = [
  "appendFile",
  "chmod",
  "copyFile",
  "cp",
  "link",
  "mkdir",
  "mkdtemp",
  "rename",
  "rm",
  "rmdir",
  "symlink",
  "truncate",
  "unlink",
  "writeFile",
];

const writers = (target: object, names: readonly string[]) =>
  names.map(name => ({ target, name }));

/** Everything that would change a file, start a process or open a socket. */
const WATCHED = [
  ...writers(fs, [
    ...FILE_WRITES,
    ...FILE_WRITES.map(name => `${name}Sync`),
    "createWriteStream",
    "open",
    "openSync",
    "write",
    "writeSync",
  ]),
  ...writers(fs.promises, [...FILE_WRITES, "open"]),
  ...writers(childProcess, [
    "exec",
    "execFile",
    "execFileSync",
    "execSync",
    "fork",
    "spawn",
    "spawnSync",
  ]),
  ...writers(net, ["connect", "createConnection", "createServer"]),
];

/** Runs `work` with those replaced, and says which of them it called. */
const touchedBy = async (work: () => unknown): Promise<string[]> => {
  const touched: string[] = [];
  const originals = WATCHED.map(({ target, name }) => ({
    target,
    name,
    original: Reflect.get(target, name) as unknown,
  }));
  for (const { target, name } of WATCHED) {
    Reflect.set(target, name, () => {
      touched.push(name);
    });
  }
  syncBuiltinESMExports();
  try {
    await work();
  } finally {
    for (const { target, name, original } of originals) {
      Reflect.set(target, name, original);
    }
    syncBuiltinESMExports();
  }
  return touched;
};

/** Calls a function by name on a module got some other way than an import. */
const called = (target: unknown, name: string): void => {
  if (typeof target !== "object" || target === null) return;
  const found: unknown = Reflect.get(target, name);
  if (typeof found === "function") Reflect.apply(found, target, []);
};

const examples = path.resolve(import.meta.dirname, "../../../examples");

const compile = (text: string): CompiledGraph => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow, {
    workflowDir: examples,
    projectRoot: examples,
  });
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const files = readdirSync(examples).filter(file => file.endsWith(".ork.yaml"));

/** Every node type that does work when it runs for real. */
const EVERY_KIND = `schemaVersion: 1
name: every-kind
limits: { budgetUsd: 1, timeout: 1h }
nodes:
  sh: { type: tool.shell, command: "touch nope", allow: ["touch"] }
  git: { type: tool.git, command: "status" }
  watched:
    type: tool.shell
    command: "true"
    allow: ["true"]
    output: { format: json, schema: { state: [wait, go] } }
    watch: { every: 30s, until: "json.state == 'go'", timeout: 1h }
  mcp: { type: mcp.call, server: s, tool: t }
  called: { type: workflow.call, workflow: other }
  worker: { type: claude.worker, prompt: x }
  ask: { type: human.gate, question: q, options: [a, b] }
edges:
  - sh -> git
  - git -> watched
  - watched -> mcp
  - mcp -> called
  - called -> worker
  - worker -> ask
`;

describe("a walk touches nothing", () => {
  it("would notice each way of doing so", async () => {
    const require = createRequire(import.meta.url);
    const required: unknown = require("node:fs");
    const touched = await touchedBy(async () => {
      mkdirSync("/nowhere");
      fs.writeFileSync("/nowhere/file", "");
      await fs.promises.writeFile("/nowhere/file", "");
      called(required, "linkSync");
      fs.openSync("/nowhere/file", "w");
      spawnSync("nothing");
      childProcess.exec("nothing");
      net.createServer();
    });
    expect(touched).toEqual([
      "mkdirSync",
      "writeFileSync",
      "writeFile",
      "linkSync",
      "openSync",
      "spawnSync",
      "exec",
      "createServer",
    ]);
  });

  it("puts things back", async () => {
    const before = fs.writeFileSync;
    await touchedBy(() => null);
    expect(fs.writeFileSync).toBe(before);
  });

  it.each(files)("%s writes no file and starts no process", async file => {
    const graph = compile(readFileSync(path.join(examples, file), "utf8"));
    const touched = await touchedBy(() => walkWorkflow(graph));
    expect(touched).toEqual([]);
  });

  it("nor does any node that would do work", async () => {
    const graph = compile(EVERY_KIND);
    const touched = await touchedBy(() => walkWorkflow(graph));
    expect(touched).toEqual([]);
  });
});
