/**
 * @file Tests for walking a fanned node (RFC-013): one node, with outcomes of
 *   its gathered fields, for each way its items and list can go.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  type CompiledGraph,
  compileWorkflow,
  walkWorkflow,
} from "../src/index.ts";
import { outcomesOf } from "../src/run/walk-outcomes.ts";

const compile = (lines: string[]): CompiledGraph => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const FROM = "from: '{{nodes.plan.output.tasks}}', maxItems: 4";

/** A fanned `build`, and a tool node `after` reached when `when` holds. */
const graphWith = (
  forEach: string,
  when: string,
  type = "tool.shell",
): CompiledGraph =>
  compile([
    "nodes:",
    "  plan:",
    "    type: tool.shell",
    "    command: x",
    "    output:",
    "      format: json",
    "      schema: { tasks: { list: {} } }",
    "  build:",
    `    type: ${type}`,
    `    ${type === "tool.shell" ? "command: x" : "prompt: x"}`,
    `    forEach: { ${forEach} }`,
    "  after:",
    "    type: tool.shell",
    "    command: x",
    "edges:",
    "  - plan -> build",
    `  - { from: build, to: after, when: "${when}" }`,
  ]);

const saidBy = (graph: CompiledGraph): string[] =>
  (outcomesOf(graph).outcomes.get("build") ?? []).map(({ said }) => said);

const countsOf = (graph: CompiledGraph): unknown[] =>
  (outcomesOf(graph).outcomes.get("build") ?? []).map(
    ({ output }) => output["count"],
  );

const neverRuns = async (graph: CompiledGraph): Promise<boolean> => {
  const walk = await walkWorkflow(graph);
  return walk.findings.some(
    ({ code, message }) =>
      code === "walk.never-runs" && message.includes("`after`"),
  );
};

/** Every status a walk tries for `build`. */
const skipped = (forEach: string): unknown[] =>
  (
    outcomesOf(graphWith(forEach, "any(statuses, 'skipped')")).outcomes.get(
      "build",
    ) ?? []
  ).flatMap(({ output }) => output["statuses"]);

describe("walking a fanned node", () => {
  it("tries success and one failed item for a static list", () => {
    expect(saidBy(graphWith("items: [a, b]", "ok"))).toEqual([
      "succeeded",
      "one item failed",
    ]);
  });

  it("tries an empty list and each answer for a from list", () => {
    expect(saidBy(graphWith(FROM, "count > 0")).slice(0, 6)).toEqual([
      "succeeded",
      "one item failed",
      "the list is empty",
      "over maxItems, ran the first",
      "over maxItems, ran all",
      "over maxItems, stopped",
    ]);
  });

  it("is one node however long its list is", async () => {
    const short = await walkWorkflow(graphWith("items: [a, b]", "ok"));
    const long = Array.from({ length: 2000 }, (_, at) => `i${String(at)}`);
    const walk = await walkWorkflow(
      graphWith(`items: [${long.join(", ")}]`, "ok"),
    );
    expect(walk.paths).toBe(short.paths);
    expect(walk.complete).toBe(true);
  });

  it("ends a run on the stop answer, with no edge out of it", async () => {
    const walk = await walkWorkflow(graphWith(FROM, "count >= 0"));
    expect(walk.endings.some(ending => ending.status === "failed")).toBe(true);
    expect(await neverRuns(graphWith(FROM, "count >= 0"))).toBe(false);
  });

  it("tries an empty list only where a list can be empty", () => {
    expect(countsOf(graphWith(FROM, "count == 0"))).toContain(0);
    expect(countsOf(graphWith("items: [a, b]", "count == 0"))).toEqual([2, 2]);
  });

  it("tries only how a from list can end when nothing reads the list", () => {
    expect(saidBy(graphWith(FROM, "ok"))).toEqual([
      "succeeded",
      "one item failed",
      "over maxItems, stopped",
    ]);
  });

  it("marks the rest skipped only for onFailure: stop", () => {
    expect(skipped("items: [a, b], onFailure: stop")).toContain("skipped");
    expect(skipped("items: [a, b]")).not.toContain("skipped");
  });

  it.each([
    "all(statuses, 'done')",
    "len(statuses) == 3",
    "count(statuses, 'fail') == 3",
  ])("makes no claim that %s can never hold", async when => {
    await expect(
      neverRuns(graphWith(FROM, when, "agent.worker")),
    ).resolves.toBe(false);
  });

  it("doesn't try every item failing when they run one by one and stop", () => {
    expect(
      saidBy(
        graphWith(
          "items: [a, b], onFailure: stop, maxParallel: 1",
          "any(statuses, 'pass')",
        ),
      ),
    ).not.toContain("all failed");
  });

  it("keeps the true count of a list too long to hold", () => {
    const huge = "from: '{{nodes.plan.output.tasks}}', maxItems: 5000000000";
    expect(countsOf(graphWith(huge, "count > 0"))).toContain(5_000_000_001);
    expect(
      countsOf(graphWith(FROM, "count > 4294967296")).length,
    ).toBeGreaterThan(0);
  });

  it("varies count over a cap only with the answer all", () => {
    expect(saidBy(graphWith(FROM, "count == 5"))).toContain(
      "succeeded, count = 5",
    );
  });

  it("reaches every item failing when statuses are read", async () => {
    expect(
      await neverRuns(graphWith("items: [a, b]", "all(statuses, 'fail')")),
    ).toBe(false);
  });

  it("tries a status only an item's type can report", async () => {
    const reading = "any(statuses, 'changes_requested')";
    expect(
      await neverRuns(graphWith("items: [a]", reading, "agent.worker")),
    ).toBe(false);
    expect(() => graphWith("items: [a]", reading)).toThrow("when.value");
  });

  it("makes no claim about statuses of a longer list", () => {
    const { cutShort } = outcomesOf(
      graphWith("items: [a, b, c]", "any(statuses, 'pass')"),
    );
    expect(cutShort).toContain("build");
  });
});
