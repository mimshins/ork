/**
 * @file Tests for the examples on scripted executors: `pr-review` (the diff
 *   feeds two reviewers in parallel, one summary follows, and the comment is
 *   posted only when the gate's answer is `post`) and `fan-out` (one worker per
 *   listed task, and a resume after a kill that reruns only the unfinished).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { parseWorkflow, serializeWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  createReplay,
  type HumanChannel,
  type NodeExecutor,
  type NodeOutput,
  resumeState,
  type RunEvent,
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
      "agent.worker": executor,
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

/** Plans three tasks; every item says which run made it. */
const fanner =
  (run: string, ran: string[]): NodeExecutor =>
  context => {
    ran.push(context.id);
    const output =
      context.item === undefined
        ? outputsOf(context.id)
        : { status: "pass", summary: `${run} ${context.id}` };
    return Promise.resolve({ ok: true, output });
  };

/** Like `fanner`, but the item `bad` fails, with the others passing. */
const flaky =
  (bad: string, ran: string[]): NodeExecutor =>
  context => {
    ran.push(context.id);
    return Promise.resolve(
      context.id === bad
        ? {
            ok: false,
            error: "it broke",
            output: { status: "fail", summary: "it broke" },
          }
        : {
            ok: true,
            output:
              context.item === undefined
                ? outputsOf(context.id)
                : { status: "pass", summary: context.id },
          },
    );
  };

const outputsOf = (id: string): NodeOutput =>
  id === "plan"
    ? {
        status: "pass",
        summary: "planned",
        tasks: [
          { title: "a", detail: "x" },
          { title: "b", detail: "y" },
          { title: "c", detail: "z" },
        ],
      }
    : { choice: "keep", answeredBy: "terminal" };

const playFanOut = async (
  run: string,
  ran: string[],
  events?: readonly RunEvent[],
) => {
  const state = events === undefined ? undefined : resumeState(events);
  const log: RunEvent[] = [];
  const executor = fanner(run, ran);
  const result = await startRun({
    graph: compile("examples/fan-out.ork.yaml"),
    inputs: { goal: "g" },
    cwd: repoRoot,
    executors: { "agent.worker": executor, "human.gate": executor },
    human,
    onEvent: event => {
      log.push(event);
    },
    ...(state === undefined
      ? {}
      : {
          replay: createReplay(
            state.history,
            state.cutOff,
            state.mail,
            state.earlier,
            state.fanOuts,
          ),
        }),
  }).done;
  return { result, events: log };
};

const parsedOrThrow = (text: string) => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

/** The events up to and including the first finish of `id`: a kill there. */
const killedAfter = (events: readonly RunEvent[], id: string): RunEvent[] =>
  events.slice(
    0,
    events.findIndex(e => e.type === "node.finished" && e.id === id) + 1,
  );

type Finished = Extract<RunEvent, { type: "node.finished" }>;

/** What the fanned node gathered from its items. */
const buildResults = (events: readonly RunEvent[]): unknown =>
  events.find(
    (event): event is Finished =>
      event.type === "node.finished" && event.id === "build",
  )?.output["results"];

describe("the fan-out example", () => {
  it("is in canonical form", () => {
    const text = readFileSync(
      path.join(repoRoot, "examples/fan-out.ork.yaml"),
      "utf8",
    );
    expect(serializeWorkflow(parsedOrThrow(text))).toBe(text);
  });

  it("builds every listed task, then asks what to keep", async () => {
    const ran: string[] = [];
    const { result } = await playFanOut("one", ran);
    expect(result.status).toBe("succeeded");
    expect(ran.toSorted()).toEqual(
      ["build.0", "build.1", "build.2", "plan", "review"].toSorted(),
    );
    expect(ran.at(-1)).toBe("review");
  });

  it("still asks what to keep when one task failed and others passed", async () => {
    const ran: string[] = [];
    const executor = flaky("build.1", ran);
    const result = await startRun({
      graph: compile("examples/fan-out.ork.yaml"),
      inputs: { goal: "g" },
      cwd: repoRoot,
      executors: { "agent.worker": executor, "human.gate": executor },
      human,
      onEvent: () => {
        // What ran is enough here.
      },
    }).done;
    expect(ran).toContain("review");
    expect(result.status).toBe("succeeded");
  });

  it("reruns only the tasks a kill left unfinished", async () => {
    const first = await playFanOut("one", []);
    const ran: string[] = [];
    const { result, events } = await playFanOut(
      "two",
      ran,
      killedAfter(first.events, "build.0"),
    );
    expect(result.status).toBe("succeeded");
    expect(ran.toSorted()).toEqual(["build.1", "build.2", "review"].toSorted());
    expect(buildResults(events)).toMatchObject([
      { summary: "one build.0" },
      { summary: "two build.1" },
      { summary: "two build.2" },
    ]);
  });
});
