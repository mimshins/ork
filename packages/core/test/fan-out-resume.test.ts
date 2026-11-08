/**
 * @file Tests for resuming a fanned node (RFC-013, ADR-026) on scripted
 *   executors: per-item replay, the recorded list, cut-off items, rounds, and a
 *   run recorded before `forEach`.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  createReplay,
  type ExecuteContext,
  type HumanChannel,
  type NodeExecutor,
  type NodeResult,
  resumeState,
  type RunEvent,
  startRun,
} from "../src/index.ts";
import { PRE_FOR_EACH_RUN } from "./fixtures/pre-for-each-run.ts";

const compile = (lines: string[]): CompiledGraph => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const fanned = (forEach: string): CompiledGraph =>
  compile([
    "nodes:",
    "  build:",
    "    type: claude.worker",
    "    prompt: do it",
    `    forEach: ${forEach}`,
  ]);

const pass = (summary: string): NodeResult => ({
  ok: true,
  output: { status: "pass", summary },
});

const human: HumanChannel = {
  ask: () => Promise.resolve("stop"),
  permit: () => Promise.resolve({ allow: true }),
};

const play = async (
  graph: CompiledGraph,
  executor: NodeExecutor,
  events?: readonly RunEvent[],
) => {
  const state = events === undefined ? undefined : resumeState(events);
  const log: RunEvent[] = [];
  const result = await startRun({
    graph,
    inputs: {},
    cwd: process.cwd(),
    executors: {
      "claude.worker": executor,
      "claude.leader": executor,
      "tool.shell": executor,
    },
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

/** The events up to and including the first that matches: a crash there. */
const crashAt = (
  events: readonly RunEvent[],
  matches: (event: RunEvent) => boolean,
): RunEvent[] => events.slice(0, events.findIndex(event => matches(event)) + 1);

const startOf =
  (id: string, round = 1) =>
  (event: RunEvent): boolean =>
    event.type === "node.started" && event.id === id && event.round === round;

const finishOf =
  (id: string) =>
  (event: RunEvent): boolean =>
    event.type === "node.finished" && event.id === id;

type Finished = Extract<RunEvent, { type: "node.finished" }>;

const finishedOf = (events: readonly RunEvent[], id: string): Finished => {
  const found = events.find(
    (event): event is Finished =>
      event.type === "node.finished" && event.id === id,
  );
  if (found === undefined) throw new Error(`${id} did not finish`);
  return found;
};

const listsOf = (events: readonly RunEvent[]): unknown[] =>
  events.flatMap(event => (event.type === "each.listed" ? [event.list] : []));

/** Each item says which run made it and what it was given. */
const made =
  (run: string, ran: string[] = []): NodeExecutor =>
  context => {
    ran.push(context.id);
    return Promise.resolve(
      pass(`${run} ${context.id}=${String(context.item?.value)}`),
    );
  };

/** Later items finish first. */
const laterFirst: NodeExecutor = async context => {
  await new Promise(resolve => {
    setTimeout(resolve, 12 - (context.item?.index ?? 0) * 8);
  });
  return made("one")(context);
};

/** Starts a session for each item, named after it and its round. */
const inSession =
  (ran: string[]): NodeExecutor =>
  context => {
    ran.push(
      `${context.id}#${String(context.round)}<${String(context.resume)}`,
    );
    const sessionId = `s-${context.id}-${String(context.round)}`;
    context.emit({ type: "session.started", sessionId, model: "m" });
    return Promise.resolve({ ...pass("did"), sessionId });
  };

/** Items in sessions, and a check that says go round once. */
const looped = (ran: string[]): NodeExecutor => {
  let checks = 0;
  const items = inSession(ran);
  return context => {
    if (context.id !== "check") return items(context);
    checks += 1;
    return Promise.resolve({ ok: true, output: { again: checks === 1 } });
  };
};

const finishesOf = (events: readonly RunEvent[]): string[] =>
  events.flatMap(event => (event.type === "node.finished" ? [event.id] : []));

const failedOnce = (): NodeResult => ({
  ok: false,
  output: { exitCode: 1 },
  error: "no",
});

/** `first` fails (and an edge handles it), `plan` lists, items echo. */
const planning =
  (tasks: string[], ran: string[]): NodeExecutor =>
  context => {
    if (context.id === "first") return Promise.resolve(failedOnce());
    if (context.id === "plan") {
      return Promise.resolve({ ok: true, output: { tasks } });
    }
    return made("two", ran)(context);
  };

/** `planning`, with items noting the session they were given. */
const replanning = (
  tasks: string[],
  seen: Record<string, string | undefined>,
): NodeExecutor => {
  const planner = planning(tasks, []);
  return context =>
    context.item === undefined ? planner(context) : resumes(seen)(context);
};

const planned = (): CompiledGraph =>
  compile([
    "nodes:",
    "  first:",
    "    type: tool.shell",
    "    command: x",
    "  plan:",
    "    type: tool.shell",
    "    command: x",
    "  build:",
    "    type: claude.worker",
    "    prompt: do it",
    "    forEach:",
    '      from: "{{nodes.plan.output.tasks}}"',
    "      maxItems: 3",
    "edges:",
    '  - { from: first, to: plan, when: "exitCode == 1" }',
    "  - plan -> build",
  ]);

/** The first run of `planned`: a crash once `build.0` has finished. */
const crashedPlan = async (cut: string) => {
  const first = await play(planned(), planning(["a", "b", "c"], []));
  return crashAt(first.events, finishOf(cut));
};

/** `build.1` opens a session, then the run crashes inside it. */
const cutInSession = (): RunEvent[] => [
  { type: "node.started", id: "build", nodeType: "claude.worker", round: 1 },
  { type: "each.listed", node: "build", round: 1, count: 2, list: ["a", "b"] },
  {
    type: "node.started",
    id: "build.0",
    nodeType: "claude.worker",
    round: 1,
    item: { of: "build", index: 0 },
  },
  {
    type: "node.finished",
    id: "build.0",
    round: 1,
    ok: true,
    output: { status: "pass", summary: "kept" },
  },
  {
    type: "node.started",
    id: "build.1",
    nodeType: "claude.worker",
    round: 1,
    item: { of: "build", index: 1 },
  },
  {
    type: "node.event",
    id: "build.1",
    event: { type: "session.started", sessionId: "s-1", model: "m" },
  },
];

const resumes =
  (out: Record<string, string | undefined>): NodeExecutor =>
  (context: ExecuteContext) => {
    out[context.id] = context.resume;
    return Promise.resolve(pass("did"));
  };

describe("resuming a fanned node", () => {
  it("reruns only the items a crash left unfinished", async () => {
    const graph = fanned("{ items: [a, b, c], maxParallel: 1 }");
    const first = await play(graph, made("one"));
    const crash = crashAt(first.events, startOf("build.1"));
    const ran: string[] = [];
    const { result, events } = await play(graph, made("two", ran), crash);
    expect(result.status).toBe("succeeded");
    expect(ran).toEqual(["build.1", "build.2"]);
    expect(finishedOf(events, "build").output["results"]).toEqual([
      { summary: "one build.0=a" },
      { summary: "two build.1=b" },
      { summary: "two build.2=c" },
    ]);
  });

  it("keeps the recorded list when the file was edited between runs", async () => {
    const first = await play(
      fanned("{ items: [a, b], maxParallel: 1 }"),
      made("one"),
    );
    const crash = crashAt(first.events, finishOf("build.0"));
    const edited = fanned("{ items: [x, y, z], maxParallel: 1 }");
    const ran: string[] = [];
    const { events } = await play(edited, made("two", ran), crash);
    expect(ran).toEqual(["build.1"]);
    expect(finishedOf(events, "build").output).toMatchObject({
      items: ["a", "b"],
      results: [{ summary: "one build.0=a" }, { summary: "two build.1=b" }],
    });
  });

  it("takes the new list and reruns every item when the source ran anew", async () => {
    const crash = await crashedPlan("build.0");
    const ran: string[] = [];
    const { events } = await play(
      planned(),
      planning(["c", "b", "a"], ran),
      crash,
    );
    expect(ran).toEqual(["build.0", "build.1", "build.2"]);
    expect(listsOf(events)).toEqual([["c", "b", "a"]]);
    expect(finishedOf(events, "build").output["results"]).toEqual([
      { summary: "two build.0=c" },
      { summary: "two build.1=b" },
      { summary: "two build.2=a" },
    ]);
  });

  it("continues a cut-off item's session, and hands the finished one back", async () => {
    const out: Record<string, string | undefined> = {};
    const graph = fanned("{ items: [a, b] }");
    const { events } = await play(graph, resumes(out), cutInSession());
    expect(out).toEqual({ "build.1": "s-1" });
    expect(finishedOf(events, "build").output["results"]).toEqual([
      { summary: "kept" },
      { summary: "did" },
    ]);
  });

  it("doesn't continue a cut session for another item of a new list", async () => {
    const seen: Record<string, string | undefined> = {};
    const crash = await crashedPlan("build.0");
    const cut: RunEvent[] = [
      ...crash,
      {
        type: "node.started",
        id: "build.1",
        nodeType: "claude.worker",
        round: 1,
        item: { of: "build", index: 1 },
      },
      {
        type: "node.event",
        id: "build.1",
        event: { type: "session.started", sessionId: "s-b", model: "m" },
      },
    ];
    await play(planned(), replanning(["z", "y"], seen), cut);
    expect(seen).toEqual({ "build.0": undefined, "build.1": undefined });
  });

  it("gives each of two items finishing out of order its own result", async () => {
    const graph = fanned("{ items: [a, b], maxParallel: 2 }");
    const first = await play(graph, laterFirst);
    expect(finishesOf(first.events)).toEqual(["build.1", "build.0", "build"]);
    const crash = crashAt(first.events, finishOf("build.0"));
    const ran: string[] = [];
    const { events } = await play(graph, made("two", ran), crash);
    expect(ran).toEqual([]);
    expect(finishedOf(events, "build").output["results"]).toEqual([
      { summary: "one build.0=a" },
      { summary: "one build.1=b" },
    ]);
  });

  it("hands a succeeded fanned node back whole, without its items", async () => {
    const graph = compile([
      "nodes:",
      "  build:",
      "    type: tool.shell",
      "    command: x",
      "    forEach: { items: [a, b] }",
      "  next:",
      "    type: tool.shell",
      "    command: x",
      "edges:",
      "  - build -> next",
    ]);
    const first = await play(graph, made("one"));
    const crash = crashAt(first.events, startOf("next"));
    const ran: string[] = [];
    const { events } = await play(graph, made("two", ran), crash);
    expect(ran).toEqual(["next"]);
    expect(listsOf(events)).toEqual([]);
  });

  it("replays items by round after a whole earlier round was handed back", async () => {
    const graph = compile([
      "nodes:",
      "  build:",
      "    type: claude.worker",
      "    session: resume",
      "    prompt: do it",
      "    forEach: { items: [a, b], maxParallel: 1 }",
      "  check:",
      "    type: tool.shell",
      "    command: x",
      "edges:",
      "  - build -> check",
      "  - { from: check, to: build, when: output.again, maxRounds: 1 }",
    ]);
    const first = await play(graph, looped([]));
    const crash = crashAt(first.events, startOf("build.1", 2));
    const ran: string[] = [];
    await play(graph, looped(ran), crash);
    expect(ran).toEqual(["build.1#2<s-build.1-1"]);
  });

  it("resumes a run recorded before forEach unchanged", async () => {
    const graph = compile([
      "nodes:",
      "  write:",
      "    type: claude.worker",
      "    prompt: x",
      "  publish:",
      "    type: tool.shell",
      "    command: x",
      "edges:",
      "  - write -> publish",
    ]);
    const state = resumeState(PRE_FOR_EACH_RUN);
    expect(state.fanOuts.lists.size).toBe(0);
    expect(state.fanOuts.items.size).toBe(0);
    const ran: string[] = [];
    const { result, events } = await play(
      graph,
      made("two", ran),
      PRE_FOR_EACH_RUN,
    );
    expect(ran).toEqual(["publish"]);
    expect(result.status).toBe("succeeded");
    expect(listsOf(events)).toEqual([]);
  });
});
