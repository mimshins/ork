/**
 * @file Tests for the `verify.heavy` warning: a node that runs as many copies
 *   (a worker a leader can spawn, a `forEach`) whose `verify:` runs one of the
 *   project's heavy commands, since each copy queues for a machine-wide slot.
 */

import { parseWorkflow, type Project } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { compileWorkflow } from "../src/index.ts";

const HEAVY: Project = {
  schemaVersion: 1,
  heavy: ["pnpm check", "pnpm check:changed"],
};

/** The `verify.heavy` warnings of a workflow's nodes, as `path: message`. */
const warned = (nodes: string[], project: Project = HEAVY): string[] => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", "nodes:", ...nodes].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return compileWorkflow(parsed.workflow, { project })
    .diagnostics.filter(d => d.code === "verify.heavy")
    .map(d => `${d.severity} ${d.path.join(".")}: ${d.message}`);
};

const leader = "  lead: { type: agent.leader, prompt: go, maxWorkers: 6 }";
const worker = (verify: string) =>
  `  work: { type: agent.worker, parent: lead, prompt: go, verify: ${verify} }`;

describe("a heavy verify: on a node that runs as many copies", () => {
  it("warns on a worker its leader can spawn", () => {
    const found = warned([leader, worker("{ command: pnpm check:changed }")]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("warning nodes.work.verify.command:");
    expect(found[0]).toContain("`pnpm check:changed`");
    expect(found[0]).toContain("can spawn up to 6 of it");
    expect(found[0]).toContain("one of the machine's heavy slots");
    expect(found[0]).toContain("light check here (format, lint, typecheck)");
  });

  it("warns on a heavy command in a verify script", () => {
    const found = warned([
      leader,
      worker('{ script: "pnpm format && pnpm check" }'),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("nodes.work.verify.script:");
    expect(found[0]).toContain("`pnpm check`");
  });

  it("warns on a forEach node", () => {
    const found = warned([
      "  each: { type: agent.worker, prompt: go, isolation: shared, forEach: { items: [a, b] }, verify: { command: pnpm check } }",
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("once per forEach item");
  });

  it("does not warn on a light verify", () => {
    expect(warned([leader, worker("{ command: pnpm check:fast }")])).toEqual(
      [],
    );
  });

  it("does not warn on a heavy verify of a node that runs once", () => {
    expect(
      warned([
        "  solo: { type: agent.worker, prompt: go, verify: { command: pnpm check } }",
      ]),
    ).toEqual([]);
    // A leader that can't spawn delegates each child once.
    expect(
      warned([
        "  lead: { type: agent.leader, prompt: go }",
        worker("{ command: pnpm check }"),
      ]),
    ).toEqual([]);
  });

  it("does not warn when the project has no heavy list", () => {
    const plain = [leader, worker("{ command: pnpm check:changed }")];
    expect(warned(plain, { schemaVersion: 1 })).toEqual([]);
    expect(warned(plain, { schemaVersion: 1, heavy: [] })).toEqual([]);
  });
});
