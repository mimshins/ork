/**
 * @file Tests for the `pr-review` example on scripted executors: the diff feeds
 *   two reviewers in parallel, one summary follows, and the comment is posted
 *   only when the gate's answer is `post`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  type HumanChannel,
  type NodeExecutor,
  type NodeOutput,
  startRun,
} from "../src/index.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const compile = (file: string): CompiledGraph => {
  const parsed = parseWorkflow(readFileSync(path.join(repoRoot, file), "utf8"));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const human: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "keep"),
  permit: () => Promise.resolve({ allow: true }),
};

/** Runs pr-review; the gate answers `choice`. Returns what ran, in order. */
const review = async (choice: string) => {
  const ran: string[] = [];
  const outputs: Record<string, NodeOutput> = {
    diff: { exitCode: 0, stdout: "+ a line", stderr: "" },
    security: { status: "pass", summary: "nothing to flag" },
    correctness: { status: "changes_requested", summary: "a missed case" },
    summary: { status: "pass", summary: "ok", comment: "Please cover x." },
    post: { choice, answeredBy: "terminal" },
    comment: { exitCode: 0, stdout: "", stderr: "" },
  };
  const executor: NodeExecutor = ({ id }) => {
    ran.push(id);
    return Promise.resolve({ ok: true, output: outputs[id] ?? {} });
  };
  const { done } = startRun({
    graph: compile("examples/pr-review.ork.yaml"),
    inputs: { pr: "7", base: "main" },
    cwd: repoRoot,
    executors: {
      "tool.shell": executor,
      "tool.gh": executor,
      "claude.worker": executor,
      "human.gate": executor,
    },
    human,
    onEvent: () => {
      // What ran is enough here.
    },
  });
  return { result: await done, ran };
};

describe("the pr-review example", () => {
  it("keeps the review local unless you say to post it", async () => {
    const kept = await review("keep");
    expect(kept.result.status).toBe("succeeded");
    expect(kept.ran.toSorted()).toEqual(
      ["correctness", "diff", "post", "security", "summary"].toSorted(),
    );
    expect(kept.ran.at(-1)).toBe("post");

    const posted = await review("post");
    expect(posted.ran.slice(-2)).toEqual(["post", "comment"]);
  });
});
