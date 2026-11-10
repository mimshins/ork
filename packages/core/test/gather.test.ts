/**
 * @file Tests for `output.gather`: what `ork validate` says about the fields it
 *   names, a node in a loop keeping every round's entries without repeats while
 *   its other fields hold the latest round, and a replayed round leaving the
 *   lists as they were.
 */

import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  type NodeExecutor,
  type NodeResult,
  type RunEvent,
  startRun,
} from "../src/index.ts";
import { joinRounds, previousOf } from "../src/run/gather.ts";
import { createReplay } from "../src/run/replay.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const load = (lines: string[]) => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const codes = (lines: string[]) =>
  compileWorkflow(load(lines)).diagnostics.map(d => `${d.code} ${d.message}`);

const LOOP = [
  "nodes:",
  "  build:",
  "    type: claude.worker",
  "    prompt: b",
  "    output:",
  "      schema: { decisions: { type: array }, note: string }",
  "      gather: [decisions]",
  "  review: { type: claude.worker, prompt: r }",
  "edges:",
  "  - build -> review",
  "  - { from: review, to: build, when: \"status != 'pass'\", maxRounds: 3 }",
];

/** `LOOP` with its `gather:` line replaced. */
const withGather = (gather: string) =>
  LOOP.map(line =>
    line === "      gather: [decisions]" ? `      ${gather}` : line,
  );

/** `LOOP` with `decisions` declared as `rule`. */
const withDecisions = (rule: string) =>
  LOOP.map(line =>
    line.includes("schema: { decisions")
      ? `      schema: { decisions: ${rule}, note: string }`
      : line,
  );

const compiled = (lines: string[]): CompiledGraph => {
  const { graph, diagnostics } = compileWorkflow(load(lines));
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

/** `build` reports these decisions per round; `review` passes on the third. */
const DECIDED = [["a", "b"], ["c"], ["a"]];

const executor: NodeExecutor = ({ id, round }) => {
  const result: NodeResult =
    id === "build"
      ? {
          ok: true,
          output: {
            status: "pass",
            summary: "built",
            decisions: DECIDED[round - 1] ?? [],
            note: `round ${String(round)}`,
          },
        }
      : {
          ok: true,
          output: {
            status: round < 3 ? "changes_requested" : "pass",
            summary: "reviewed",
          },
        };
  return Promise.resolve(result);
};

const lastBuild = async () => {
  const events: RunEvent[] = [];
  await startRun({
    graph: compiled(LOOP),
    inputs: {},
    cwd: repoRoot,
    executors: { "claude.worker": executor },
    human: {
      ask: () => Promise.resolve("stop"),
      permit: () => Promise.resolve({ allow: true }),
    },
    runId: "r1",
    onEvent: event => {
      events.push(event);
    },
  }).done;
  return events
    .flatMap(event =>
      event.type === "node.finished" && event.id === "build"
        ? [event.output]
        : [],
    )
    .at(-1);
};

describe("output.gather", () => {
  it("is fine on a field declared as a list", () => {
    expect(
      codes(LOOP).filter(line => line.startsWith("output.gather")),
    ).toEqual([]);
  });

  it.each([
    ["a field the node doesn't declare", "gather: [missing]", "isn't in"],
    ["a field that isn't a list", "gather: [note]", "isn't declared as a list"],
  ])("refuses %s", (_name, gather, says) => {
    expect(codes(withGather(gather)).some(line => line.includes(says))).toBe(
      true,
    );
  });

  it("takes a declared { list: { … } } as a list", () => {
    expect(
      codes(withDecisions("{ list: { what: string } }")).filter(line =>
        line.startsWith("output.gather"),
      ),
    ).toEqual([]);
  });

  it("never sees a list rule the run wouldn't hold to a list", () => {
    expect(() => codes(withDecisions("{ list: string }"))).toThrow(
      "`list` takes a map",
    );
  });

  it("refuses a node with forEach", () => {
    const lines = [
      "nodes:",
      "  build:",
      "    type: claude.worker",
      "    prompt: b",
      "    forEach: { items: [x, y] }",
      "    output:",
      "      schema: { decisions: { type: array } }",
      "      gather: [decisions]",
    ];
    expect(codes(lines).some(line => line.includes("runs once per item"))).toBe(
      true,
    );
  });

  it("keeps every round's entries once, and the other fields from the last round", async () => {
    expect(await lastBuild()).toMatchObject({
      decisions: ["a", "b", "c"],
      note: "round 3",
    });
  });

  it("changes nothing when a replayed round is gathered again", () => {
    const before = { decisions: ["a", "b", "c"] };
    const replayed: NodeResult = {
      ok: true,
      output: { decisions: ["a", "b", "c"] },
    };
    expect(joinRounds(["decisions"], before, replayed).output).toEqual(before);
  });
});

describe("what a round gathers onto", () => {
  const replay = createReplay(
    new Map([["impl", [{ ok: true, output: { decisions: ["a"] } }]]]),
  );
  const brief = { from: "lead", text: "do it" };

  it("is a delegated child's last report from before a resume", () => {
    expect(previousOf({ id: "impl", brief }, undefined, replay)).toEqual({
      decisions: ["a"],
    });
  });

  it("is nothing for a spawned instance, whose id another worker reuses", () => {
    expect(
      previousOf(
        { id: "impl-2", template: "impl", brief },
        { decisions: ["x"] },
        replay,
      ),
    ).toBeUndefined();
  });

  it("is the node's own last round otherwise", () => {
    expect(previousOf({ id: "impl" }, { decisions: ["b"] }, replay)).toEqual({
      decisions: ["b"],
    });
  });
});
