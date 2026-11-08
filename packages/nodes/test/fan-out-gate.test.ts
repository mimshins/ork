/**
 * @file Tests for a gate reading a fanned node's gathered output (RFC-013,
 *   ADR-068): the question and document show readable text, not JSON.
 */

import {
  compileWorkflow,
  type HumanQuestion,
  startRun,
} from "@krapht/ork-core";
import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { gateExecutor } from "../src/gate.ts";

const source = [
  "schemaVersion: 1",
  "name: t",
  "nodes:",
  "  build:",
  "    type: tool.shell",
  "    command: x",
  "    forEach: { items: [a, b] }",
  "  gate:",
  "    type: human.gate",
  '    question: "Merge these? {{nodes.build.output.results}}"',
  '    document: "{{nodes.build.output.results}}"',
  "    options: [yes, no]",
  "edges:",
  "  - build -> gate",
].join("\n");

const compiled = () => {
  const parsed = parseWorkflow(source);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

describe("a gate reading what a fan-out gathered", () => {
  it("shows each item's branch as readable text", async () => {
    const asked: HumanQuestion[] = [];
    await startRun({
      graph: compiled(),
      inputs: {},
      cwd: process.cwd(),
      executors: {
        "human.gate": gateExecutor,
        "tool.shell": context =>
          Promise.resolve({
            ok: true,
            output: {
              summary: `did ${context.id}`,
              branch: `ork/r1/${context.id}`,
            },
          }),
      },
      human: {
        ask: question => {
          asked.push(question);
          return Promise.resolve("yes");
        },
        permit: () => Promise.resolve({ allow: true }),
      },
      onEvent: () => {},
    }).done;
    const [question] = asked;
    expect(question?.question).toContain("branch: ork/r1/build.1");
    expect(question?.question).not.toContain("{");
    expect(question?.document).toContain("- summary: did build.0");
  });
});
