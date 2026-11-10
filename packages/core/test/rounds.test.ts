/**
 * @file Tests for rounds on scripted executors: an edge whose source can't run
 *   again in a round counts as not taken, so a node fed by a branch that didn't
 *   run is skipped and a join behind it fires, in the first round and in later
 *   ones, for `all` and `any` joins; and a run left waiting doesn't end
 *   `succeeded`.
 */

import path from "node:path";
import { setTimeout } from "node:timers/promises";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  createInbox,
  type HumanChannel,
  type Inputs,
  type NodeExecutor,
  type NodeExecutors,
  type NodeResult,
  type RunEvent,
  startRun,
  stuckReason,
} from "../src/index.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const compile = (yaml: string): CompiledGraph => {
  const parsed = parseWorkflow(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const workflow = (nodes: string[], edges: string[]) =>
  compile(
    [
      "schemaVersion: 1",
      "name: t",
      "inputs:",
      "  engine: { type: boolean, default: false }",
      "  ui: { type: boolean, default: false }",
      "nodes:",
      ...nodes.map(node => `  ${node}`),
      "edges:",
      ...edges.map(edge => `  - ${edge}`),
    ].join("\n"),
  );

/** Each node's nth run answers with the nth status; the last one repeats. */
const scripted = (statuses: Record<string, string[]>) => {
  const ran: string[] = [];
  const executor: NodeExecutor = context => {
    ran.push(context.id);
    const answers = statuses[context.id] ?? [];
    const status = answers[context.round - 1] ?? answers.at(-1) ?? "pass";
    const result: NodeResult = {
      ok: status !== "fail",
      output: { status, summary: "ok", exitCode: 0 },
    };
    return Promise.resolve(result);
  };
  const executors: NodeExecutors = {
    "claude.worker": executor,
    "tool.shell": executor,
  };
  return { executors, ran };
};

const answering = (choice: string) => {
  const asked: string[] = [];
  const human: HumanChannel = {
    ask: ({ question }) => {
      asked.push(question);
      return Promise.resolve(choice);
    },
    permit: () => Promise.resolve({ allow: true }),
  };
  return { human, asked };
};

const run = async (
  graph: CompiledGraph,
  statuses: Record<string, string[]>,
  inputs: Inputs,
  choice = "stop",
) => {
  const { executors, ran } = scripted(statuses);
  const { human, asked } = answering(choice);
  const events: RunEvent[] = [];
  const result = await startRun({
    graph,
    inputs,
    cwd: repoRoot,
    executors,
    human,
    runId: "r1",
    onEvent: event => {
      events.push(event);
    },
  }).done;
  const skipped = events.flatMap(event =>
    event.type === "node.skipped" ? [event.id] : [],
  );
  return { result, ran, asked, skipped };
};

const WORKER = (prompt: string) => `{ type: claude.worker, prompt: ${prompt} }`;

/** Two builders, one chosen by an input; `a11y` hangs off both. */
const BUILDERS = [
  "task: { type: tool.shell, command: 'true' }",
  `build: ${WORKER("b")}`,
  `engine: ${WORKER("e")}`,
];

const BUILDER_EDGES = [
  "{ from: task, to: build, when: 'ok && !inputs.engine' }",
  "{ from: task, to: engine, when: 'ok && inputs.engine' }",
];

const LOOP_EDGES = [
  "review -> reviews",
  "a11y -> reviews",
  "{ from: reviews, to: build, when: \"!all(statuses, 'pass') && !inputs.engine\", maxRounds: 2 }",
  "{ from: reviews, to: engine, when: \"!all(statuses, 'pass') && inputs.engine\", maxRounds: 2 }",
  "{ from: reviews, to: docs, when: \"all(statuses, 'pass')\" }",
];

/** The reproduction: a join of `review` and `a11y` loops back to a builder. */
const twoBuilders = () =>
  workflow(
    [
      ...BUILDERS,
      `review: ${WORKER("r")}`,
      `a11y: ${WORKER("a")}`,
      "reviews: { type: control.join, mode: all }",
      `docs: ${WORKER("d")}`,
    ],
    [
      ...BUILDER_EDGES,
      "build -> review",
      "engine -> review",
      "{ from: build, to: a11y, when: 'ok && inputs.ui' }",
      "{ from: engine, to: a11y, when: 'ok && inputs.ui' }",
      ...LOOP_EDGES,
    ],
  );

/** The same, with the builders gathered by a join in `any` mode. */
const anyJoin = () =>
  workflow(
    [
      ...BUILDERS,
      "built: { type: control.join, mode: any }",
      `review: ${WORKER("r")}`,
      `a11y: ${WORKER("a")}`,
      "reviews: { type: control.join, mode: all }",
      `docs: ${WORKER("d")}`,
    ],
    [
      ...BUILDER_EDGES,
      "build -> built",
      "engine -> built",
      "built -> review",
      "{ from: built, to: a11y, when: 'inputs.ui' }",
      ...LOOP_EDGES,
    ],
  );

const twice = { review: ["changes_requested", "pass"] };

describe("a round whose other branch didn't run", () => {
  it("skips a node fed only by branches that didn't run, so the join fires", async () => {
    const { result, ran, skipped } = await run(twoBuilders(), twice, {
      engine: false,
      ui: false,
    });

    expect(result.status).toBe("succeeded");
    expect(ran).toEqual(["task", "build", "review", "build", "review", "docs"]);
    expect(skipped).toEqual(["engine", "a11y", "docs", "a11y"]);
  });

  it("does the same with the other builder chosen", async () => {
    const { result, ran } = await run(twoBuilders(), twice, {
      engine: true,
      ui: false,
    });

    expect(result.status).toBe("succeeded");
    expect(ran).toEqual([
      "task",
      "engine",
      "review",
      "engine",
      "review",
      "docs",
    ]);
  });

  it("still waits for a node that runs in each round", async () => {
    const { result, ran } = await run(twoBuilders(), twice, {
      engine: false,
      ui: true,
    });

    expect(result.status).toBe("succeeded");
    expect(ran.filter(id => id === "a11y")).toHaveLength(2);
    expect(ran.at(-1)).toBe("docs");
  });

  it("asks when the loop runs out of rounds, rather than ending succeeded", async () => {
    const { result, asked, ran } = await run(
      twoBuilders(),
      { review: ["changes_requested"] },
      { engine: false, ui: false },
    );

    expect(asked).toEqual([
      "The loop reviews -> build used all 2 of its rounds. What now?",
    ]);
    expect(ran.filter(id => id === "build")).toHaveLength(3);
    expect(result.status).toBe("failed");
  });

  it("fires an `any` join again in a later round, and asks when out of rounds", async () => {
    const { result, asked, ran } = await run(
      anyJoin(),
      { review: ["changes_requested"] },
      { engine: false, ui: false },
    );

    expect(ran.filter(id => id === "review")).toHaveLength(3);
    expect(asked).toEqual([
      "The loop reviews -> build used all 2 of its rounds. What now?",
    ]);
    expect(result.status).toBe("failed");
  });

  it("reaches the end through an `any` join in a later round", async () => {
    const { result, ran } = await run(anyJoin(), twice, {
      engine: false,
      ui: false,
    });

    expect(result.status).toBe("succeeded");
    expect(ran.at(-1)).toBe("docs");
  });

  it("waits on every input in the first round, and only the loop's in the next", async () => {
    const graph = workflow(
      [
        `build: ${WORKER("b")}`,
        `fix: ${WORKER("f")}`,
        "both: { type: control.join, mode: all }",
        `review: ${WORKER("r")}`,
        `docs: ${WORKER("d")}`,
      ],
      [
        "build -> both",
        "fix -> both",
        "both -> review",
        "{ from: review, to: fix, when: \"status != 'pass'\", maxRounds: 2 }",
        "{ from: review, to: docs, when: \"status == 'pass'\" }",
      ],
    );
    const { result, ran } = await run(graph, twice, {});

    expect(result.status).toBe("succeeded");
    expect(ran).toEqual(["build", "fix", "review", "fix", "review", "docs"]);
  });
});

/** The edge out of `from`. */
const edgeFrom = (graph: CompiledGraph, from: string) => {
  const edge = graph.edges.find(e => e.from === from);
  if (edge === undefined) throw new Error(`no edge from ${from}`);
  return edge;
};

describe("a run left waiting", () => {
  it("names each node still waiting, as a bug in Ork", () => {
    expect(
      stuckReason([{ id: "reviews", waitingOn: ["a11y"] }]),
    ).toMatchInlineSnapshot(
      `"ork engine error: reviews was still waiting on a11y with nothing left to run; this is a bug in Ork, not in the workflow"`,
    );
  });

  it("lists what a join still waits on", () => {
    const graph = twoBuilders();
    const inbox = createInbox(graph);
    inbox.arrive(edgeFrom(graph, "review"), true, { status: "pass" });

    expect(inbox.waiting()).toEqual([{ id: "reviews", waitingOn: ["a11y"] }]);
  });
});

/** Each node takes its delay in ms; the events say what started and ended. */
const timed = async (delays: Record<string, number>) => {
  const executor: NodeExecutor = async context => {
    await setTimeout(delays[context.id] ?? 0);
    return { ok: true, output: { status: "pass", summary: "ok" } };
  };
  const marks: string[] = [];
  await startRun({
    graph: workflow(
      [`fast: ${WORKER("f")}`, `slow: ${WORKER("s")}`, `after: ${WORKER("a")}`],
      ["fast -> after", "slow -> after"],
    ),
    inputs: {},
    cwd: repoRoot,
    executors: { "claude.worker": executor },
    human: answering("stop").human,
    runId: "r1",
    onEvent: event => {
      if (event.type === "node.started" || event.type === "node.finished") {
        marks.push(`${event.type} ${event.id} ${String(event.round)}`);
      }
    },
  }).done;
  return marks.filter(mark => mark.includes(" after "));
};

describe("a node fed twice", () => {
  it("runs its next round only once the one before it has finished", async () => {
    expect(await timed({ slow: 10, after: 40 })).toEqual([
      "node.started after 1",
      "node.finished after 1",
      "node.started after 2",
      "node.finished after 2",
    ]);
  });
});
