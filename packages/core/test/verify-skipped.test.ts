/**
 * @file Tests that a node's `skipped` port (a `once: true` check that passed
 *   before on identical files) reaches the run's events as `verify.skipped`,
 *   with the node's id, the check and the earlier pass.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  type CompiledGraph,
  compileWorkflow,
  type NodeExecutor,
  type RunEvent,
  startRun,
} from "../src/index.ts";

const compile = (yaml: string): CompiledGraph => {
  const parsed = parseWorkflow(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const PASS = { at: "2026-11-11T10:00:00.000Z", who: "r0/docs" };

describe("verify.skipped", () => {
  it("is recorded when a node says its check was skipped", async () => {
    const graph = compile(
      [
        "schemaVersion: 1",
        "name: t",
        "nodes:",
        "  check: { type: tool.shell, command: pnpm check, once: true }",
        "edges: []",
      ].join("\n"),
    );
    const executor: NodeExecutor = context => {
      context.skipped?.("pnpm check", PASS);
      return Promise.resolve({ ok: true, output: { exitCode: 0 } });
    };
    const events: RunEvent[] = [];
    const handle = startRun({
      graph,
      inputs: {},
      cwd: mkdtempSync(path.join(tmpdir(), "ork-skipped-")),
      executors: { "tool.shell": executor },
      human: {
        permit: () => Promise.resolve({ allow: true }),
        ask: () => Promise.resolve(""),
      },
      onEvent: event => {
        events.push(event);
      },
    });
    expect((await handle.done).status).toBe("succeeded");
    expect(events.filter(event => event.type === "verify.skipped")).toEqual([
      { type: "verify.skipped", id: "check", check: "pnpm check", ...PASS },
    ]);
  });
});
