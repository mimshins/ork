/**
 * @file Tests for a list over its `maxItems` (RFC-013): the question goes to a
 *   live owner or the human, each answer does what it says, nobody there means
 *   stop, and a resumed run gets the answer given last time.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  createReplay,
  type HumanChannel,
  type NodeExecutor,
  replayLoopAnswers,
  resumeState,
  type RunEvent,
  runTree,
  startRun,
} from "../src/index.ts";
import { unmasked } from "../src/run/declared.ts";
import { eachQuestion } from "../src/run/escalation.ts";

const LINES = [
  "nodes:",
  "  plan:",
  "    type: tool.shell",
  "    command: x",
  "  build:",
  "    type: tool.shell",
  "    command: x",
  "    forEach:",
  '      from: "{{nodes.plan.output.tasks}}"',
  "      maxItems: 2",
  "edges:",
  "  - plan -> build",
];

const compile = (lines: string[]): CompiledGraph => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const answering = (answer: string): HumanChannel => ({
  ask: () => Promise.resolve(answer),
  permit: () => Promise.resolve({ allow: true }),
});

/** No terminal: a run takes the recommended choice. */
const noTerminal: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: true }),
};

const planThen =
  (ran: string[]): NodeExecutor =>
  context => {
    if (context.id === "plan") {
      return Promise.resolve({
        ok: true,
        output: { tasks: ["a", "b", "c", "d"] },
      });
    }
    ran.push(context.id);
    return Promise.resolve({ ok: true, output: {} });
  };

const allTools = (executor: NodeExecutor) => ({
  "tool.shell": executor,
  "claude.leader": executor,
  "claude.worker": executor,
});

const play = async (human: HumanChannel, ran: string[] = []) => {
  const events: RunEvent[] = [];
  const result = await startRun({
    graph: compile(LINES),
    inputs: {},
    cwd: process.cwd(),
    executors: allTools(planThen(ran)),
    human,
    onEvent: event => {
      events.push(event);
    },
  }).done;
  return { result, events };
};

type Finished = Extract<RunEvent, { type: "node.finished" }>;

const buildFinished = (events: readonly RunEvent[]): Finished | undefined =>
  events.find(
    (event): event is Finished =>
      event.type === "node.finished" && event.id === "build",
  );

const started = (events: readonly RunEvent[]): string[] =>
  events.flatMap(event => (event.type === "node.started" ? [event.id] : []));

/** Plans `tasks`; every other node does nothing. */
const planning =
  (tasks: string[]): NodeExecutor =>
  context =>
    Promise.resolve({
      ok: true,
      output: context.id === "plan" ? { tasks } : {},
    });

const listedCounts = (events: readonly RunEvent[]): number[] =>
  events.flatMap(event => (event.type === "each.listed" ? [event.count] : []));

/** A leader that answers the question it is pushed about the list. */
const ownerAnswers = (answer: string, ran: string[]) => {
  const pushed: string[] = [];
  const executor: NodeExecutor = async context => {
    if (context.id !== "lead") return planThen(ran)(context);
    const asked = Promise.withResolvers<string>();
    const stop = context.mailbox?.connect(text => {
      pushed.push(text);
      asked.resolve(/Question (q\d+)/u.exec(text)?.[1] ?? "");
    });
    context.mailbox?.answer(await asked.promise, answer);
    // Stays live until the run has its answer in hand.
    await new Promise(resolve => {
      setTimeout(resolve, 5);
    });
    stop?.();
    return { ok: true, output: {} };
  };
  return { executor, pushed };
};

const owned = (): CompiledGraph =>
  compile([
    "nodes:",
    "  lead:",
    "    type: claude.leader",
    "    prompt: lead",
    "  plan:",
    "    type: tool.shell",
    "    command: x",
    "  build:",
    "    type: tool.shell",
    "    command: x",
    "    parent: lead",
    "    forEach:",
    '      from: "{{nodes.plan.output.tasks}}"',
    "      maxItems: 2",
    "edges:",
    "  - plan -> build",
  ]);

/** The first run: stopped by a crash right after someone answered. */
const crashedAfterAnswer = (answer: string): RunEvent[] => [
  { type: "node.started", id: "plan", nodeType: "tool.shell", round: 1 },
  {
    type: "node.finished",
    id: "plan",
    round: 1,
    ok: true,
    output: { tasks: ["a", "b", "c", "d"] },
  },
  { type: "node.started", id: "build", nodeType: "tool.shell", round: 1 },
  {
    type: "each.listed",
    node: "build",
    round: 1,
    count: 4,
    list: ["a", "b", "c", "d"],
  },
  { type: "each.exceeded", node: "build", round: 1, count: 4, maxItems: 2 },
  {
    type: "decision.opened",
    decision: "d1",
    kind: "question",
    node: "build",
    question:
      "The list of build has 4 items, more than its maxItems of 2. What now?",
    options: [],
  },
  {
    type: "decision.answered",
    node: "build",
    decision: "d1",
    answer,
    by: "terminal",
  },
];

const resumeOf = (events: readonly RunEvent[], ran: string[]) => {
  const state = resumeState(events);
  const asked: string[] = [];
  const human = replayLoopAnswers(
    {
      ask: ({ question }) => {
        asked.push(question);
        return Promise.resolve("stop");
      },
      permit: () => Promise.resolve({ allow: true }),
    },
    state.loopAnswers,
  );
  return startRun({
    graph: compile(LINES),
    inputs: {},
    cwd: process.cwd(),
    executors: allTools(planThen(ran)),
    human,
    onEvent: () => {},
    replay: createReplay(
      state.history,
      state.cutOff,
      state.mail,
      state.earlier,
      state.fanOuts,
    ),
  }).done.then(result => ({ result, asked }));
};

describe("a list over its maxItems", () => {
  it("records the list, then that it is over, then asks", async () => {
    const asked: string[] = [];
    const { events } = await play({
      ask: ({ question, options, recommended }) => {
        asked.push(
          question,
          options.map(o => o.id).join(),
          String(recommended),
        );
        return Promise.resolve("all");
      },
      permit: () => Promise.resolve({ allow: true }),
    });
    expect(asked).toEqual([
      "The list of build has 4 items, more than its maxItems of 2. What now?",
      "stop,first,all",
      "stop",
    ]);
    expect(events).toContainEqual({
      type: "each.exceeded",
      node: "build",
      round: 1,
      count: 4,
      maxItems: 2,
    });
  });

  it("stops the run on stop, with a reason and no items", async () => {
    const { result, events } = await play(answering("stop"));
    expect(result.status).toBe("failed");
    expect(result.reasons[0]).toContain("over maxItems 2");
    expect(started(events)).not.toContain("build.0");
    expect(buildFinished(events)?.ok).toBe(false);
  });

  it("runs the first maxItems on first", async () => {
    const ran: string[] = [];
    const { result, events } = await play(answering("first"), ran);
    expect(result.status).toBe("succeeded");
    expect(ran).toEqual(["build.0", "build.1"]);
    expect(buildFinished(events)?.output).toMatchObject({
      items: ["a", "b"],
      count: 2,
    });
  });

  it("records the shorter list on first, so a count of its items ends true", async () => {
    const events: RunEvent[] = [];
    const tasks = Array.from({ length: 10 }, (_, index) => `t${String(index)}`);
    const result = await startRun({
      graph: compile(LINES.map(l => l.replace("maxItems: 2", "maxItems: 6"))),
      inputs: {},
      cwd: process.cwd(),
      executors: allTools(planning(tasks)),
      human: answering("first"),
      onEvent: event => {
        events.push(event);
      },
    }).done;
    expect(result.status).toBe("succeeded");
    expect(listedCounts(events)).toEqual([10, 6]);
    expect(runTree(events).find(n => n.id === "build")?.listed).toBe(6);
  });

  it("records the list once on all", async () => {
    const { events } = await play(answering("all"));
    expect(listedCounts(events)).toEqual([4]);
  });

  it("resumes the shorter list, without asking", async () => {
    const ran: string[] = [];
    const { result, asked } = await resumeOf(
      [
        ...crashedAfterAnswer("first"),
        {
          type: "each.listed",
          node: "build",
          round: 1,
          count: 2,
          list: ["a", "b"],
        },
      ],
      ran,
    );
    expect(asked).toEqual([]);
    expect(ran).toEqual(["build.0", "build.1"]);
    expect(result.status).toBe("succeeded");
  });

  it("runs the whole list on all", async () => {
    const ran: string[] = [];
    const { result, events } = await play(answering("all"), ran);
    expect(result.status).toBe("succeeded");
    expect(ran).toHaveLength(4);
    expect(buildFinished(events)?.output["count"]).toBe(4);
  });

  it("stops when no one is there to answer", async () => {
    const { result } = await play(noTerminal);
    expect(result.status).toBe("failed");
  });

  it("asks a live owner before the human", async () => {
    const ran: string[] = [];
    const { executor, pushed } = ownerAnswers("first", ran);
    const events: RunEvent[] = [];
    const result = await startRun({
      graph: owned(),
      inputs: {},
      cwd: process.cwd(),
      executors: allTools(executor),
      human: answering("all"),
      onEvent: event => {
        events.push(event);
      },
    }).done;
    expect(result.status).toBe("succeeded");
    expect(ran).toEqual(["build.0", "build.1"]);
    expect(pushed[0]).toContain("as the owner of build");
    expect(events.some(event => event.type === "owner.answered")).toBe(true);
  });

  it("gives the answer again on resume, without asking", async () => {
    const ran: string[] = [];
    const { result, asked } = await resumeOf(crashedAfterAnswer("first"), ran);
    expect(asked).toEqual([]);
    expect(ran).toEqual(["build.0", "build.1"]);
    expect(result.status).toBe("succeeded");
  });
});

const opened = (decision: string, question: string): RunEvent => ({
  type: "decision.opened",
  decision,
  kind: "question",
  node: "build",
  question,
  options: [],
});
const over = (node: string): RunEvent => ({
  type: "each.exceeded",
  node,
  round: 1,
  count: 4,
  maxItems: 2,
});
const answered = (decision: string, answer: string): RunEvent => ({
  type: "decision.answered",
  node: "build",
  decision,
  answer,
  by: "terminal",
});

describe("the question about a list over its cap", () => {
  it("names a later round, so a resume can't reuse another's answer", () => {
    expect(eachQuestion("build", 4, 2).question).toBe(
      "The list of build has 4 items, more than its maxItems of 2. What now?",
    );
    expect(eachQuestion("build", 4, 2, 2).question).toContain(
      "The list of build (round 2) has",
    );
  });

  it("keeps both answers of two lists over their caps at once", () => {
    const state = resumeState([
      over("a"),
      over("b"),
      opened("d1", "a?"),
      opened("d2", "b?"),
      answered("d1", "all"),
      answered("d2", "first"),
    ]);
    expect(state.loopAnswers).toEqual([
      { question: "a?", answer: "all" },
      { question: "b?", answer: "first" },
    ]);
  });
});

describe("a list handed back on resume", () => {
  const SECRET = `Bearer ${"a".repeat(24)}`;

  it("is the file's when the record is its masked form", () => {
    expect(unmasked({ items: [SECRET] }, ["Bearer [masked]"])).toEqual([
      SECRET,
    ]);
  });

  it("stays as recorded when the file's list changed", () => {
    expect(unmasked({ items: ["other"] }, ["Bearer [masked]"])).toEqual([
      "Bearer [masked]",
    ]);
  });
});
