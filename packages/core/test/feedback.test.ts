/**
 * @file Tests for feedback capture: fingerprints, the agents' port (cap,
 *   duplicates, masking), the system signals Ork derives from a run's events,
 *   and the store's records grouped into items.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  createFeedback,
  createSignals,
  type CompiledGraph,
  type FeedbackReport,
  fingerprint,
  humanNoteEvent,
  openStore,
  type RunEvent,
  runScrubber,
  targetOf,
} from "../src/index.ts";

const compile = (lines: string[]): CompiledGraph => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const GRAPH = compile(["nodes:", "  fix: { type: agent.worker, prompt: f }"]);

/** A run's env-value scrubber with one secret set. */
const SCRUB = runScrubber(["DB_PASSWORD"], { DB_PASSWORD: "hunter2-and-more" });

/** The feedback records among `events`. */
const reports = (events: readonly RunEvent[]): FeedbackReport[] =>
  events.flatMap(e => (e.type === "feedback.recorded" ? [e.feedback] : []));

describe("fingerprints", () => {
  it("group titles that differ only in numbers and punctuation", () => {
    const one = {
      target: "workflow",
      kind: "workflow",
      title: "Loop ran 2 rounds!",
    } as const;
    expect(fingerprint(one)).toBe(
      fingerprint({ ...one, title: "loop ran 3 rounds" }),
    );
    expect(fingerprint(one)).not.toBe(fingerprint({ ...one, target: "ork" }));
    expect(fingerprint(one)).toMatch(/^[0-9a-f]{12}$/u);
  });

  it("take a target from the kind when the agent gives none", () => {
    expect(targetOf({ kind: "bug", title: "x" })).toBe("ork");
    expect(targetOf({ kind: "context-gap", title: "x" })).toBe("project");
    expect(targetOf({ kind: "friction", title: "x" })).toBe("workflow");
    expect(targetOf({ kind: "bug", target: "project", title: "x" })).toBe(
      "project",
    );
  });
});

describe("the agents' port", () => {
  it("records, masks, drops duplicates and caps a session", () => {
    const events: RunEvent[] = [];
    const feedback = createFeedback({
      graph: GRAPH,
      onEvent: event => {
        events.push(event);
      },
    });
    const port = feedback.port("fix");
    expect(
      port.report({
        kind: "context-gap",
        title: "No test command",
        body: "AGENTS.md says nothing; token ghp_abcdefghijklmnopqrstuvwxyz0123",
        evidence: ["AGENTS.md"],
      }),
    ).toMatchObject({ ok: true });
    expect(
      port.report({ kind: "context-gap", title: "no test command" }),
    ).toMatchObject({ ok: true });
    port.report({ kind: "idea", title: "two" });
    port.report({ kind: "idea", title: "three" });
    expect(port.report({ kind: "idea", title: "four" })).toEqual({
      ok: false,
      error:
        "you already sent 3 reports in this session; keep the rest for the work",
    });
    expect(port.report({ kind: "idea", title: "  " })).toMatchObject({
      ok: false,
    });
    const [first] = reports(events);
    expect(reports(events)).toHaveLength(3);
    expect(first).toMatchObject({
      source: "agent",
      target: "project",
      severity: "medium",
      body: "AGENTS.md says nothing; token [masked]",
      evidence: ["AGENTS.md"],
      origin: { nodeType: "agent.worker" },
    });
    // A new session has its own cap; the run still drops duplicates.
    expect(
      feedback.port("fix").report({ kind: "idea", title: "five" }),
    ).toMatchObject({ ok: true });
    expect(reports(events)).toHaveLength(4);
  });

  it("masks a run's configured env secret in an agent's report", () => {
    const events: RunEvent[] = [];
    const port = createFeedback({
      graph: GRAPH,
      onEvent: event => {
        events.push(event);
      },
      scrub: SCRUB,
    }).port("fix");
    port.report({
      kind: "bug",
      title: "Login fails with hunter2-and-more",
      body: "DB_PASSWORD=hunter2-and-more was refused",
      evidence: ["log: hunter2-and-more"],
    });
    expect(reports(events)[0]).toMatchObject({
      title: "Login fails with [masked]",
      body: "DB_PASSWORD=[masked] was refused",
      evidence: ["log: [masked]"],
    });
  });

  it("masks a configured env secret in a person's note", () => {
    const event = humanNoteEvent(
      { text: "It printed hunter2-and-more", workflow: "w" },
      SCRUB,
    );
    expect(reports([event])[0]).toMatchObject({
      title: "It printed [masked]",
      body: "It printed [masked]",
    });
  });
});

/** Feeds `events` to a run's signals and returns what would be recorded. */
const observe = (events: readonly RunEvent[]): RunEvent[] => {
  const signals = createSignals({ version: "1.2.3", workflowHash: "abc" });
  return events.flatMap(event => signals(event));
};

const RUN: RunEvent[] = [
  {
    type: "run.started",
    runId: "r1",
    workflow: "ship",
    entries: ["fix"],
    nodes: [],
  },
  { type: "node.started", id: "fix", nodeType: "agent.worker", round: 1 },
  {
    type: "node.event",
    id: "fix",
    event: {
      type: "session.started",
      sessionId: "s",
      model: "sonnet",
      driver: "claude-code",
    },
  },
  {
    type: "node.event",
    id: "fix",
    event: {
      type: "tool.called",
      id: "t1",
      name: "mcp__ork__claim",
      input: {},
    },
  },
  {
    type: "node.event",
    id: "fix",
    event: { type: "tool.result", id: "t1", isError: true },
  },
  {
    type: "decision.opened",
    node: "fix",
    decision: "r1-1",
    kind: "permission",
    question: "Allow Bash?",
    options: [],
  },
  {
    type: "decision.answered",
    node: "fix",
    decision: "r1-1",
    answer: "deny",
    by: "terminal",
  },
  {
    type: "decision.opened",
    node: "fix",
    decision: "r1-2",
    kind: "question",
    question: "Which approach?",
    options: [],
    recommended: "a",
  },
  {
    type: "decision.answered",
    node: "fix",
    decision: "r1-2",
    answer: "b",
    by: "decide",
  },
  { type: "loop.exhausted", from: "fix", to: "fix", maxRounds: 2 },
  { type: "loop.exhausted", from: "fix", to: "fix", maxRounds: 2 },
  { type: "node.started", id: "gate", nodeType: "human.gate", round: 1 },
  {
    type: "node.finished",
    id: "gate",
    round: 1,
    ok: true,
    output: { choice: "hold", answeredBy: "timeout" },
  },
  {
    type: "feedback.recorded",
    node: "fix",
    feedback: {
      source: "agent",
      kind: "idea",
      target: "ork",
      severity: "low",
      title: "x",
      body: "",
      evidence: [],
      fingerprint: "f1",
      origin: { nodeType: "agent.worker" },
    },
  },
  {
    type: "run.finished",
    result: {
      runId: "r1",
      status: "budget_exhausted",
      costUsd: 2,
      nodes: [],
      reasons: [],
      worktrees: [],
    },
  },
];

/** RUN up to its two answers, answered with `permission` and `question`. */
const answering = (permission: string, question: string): RunEvent[] => [
  ...RUN.slice(0, 6),
  {
    type: "decision.answered",
    node: "fix",
    decision: "r1-1",
    answer: permission,
    by: "terminal",
  },
  ...RUN.slice(7, 8),
  {
    type: "decision.answered",
    node: "fix",
    decision: "r1-2",
    answer: question,
    by: "decide",
  },
];

/** Node `id` calling Ork's `tool` once, and the result it got back. */
const toolCall = (
  id: string,
  tool: string,
  result: { fault?: "arguments" | "refused"; message?: string },
): RunEvent[] => [
  {
    type: "node.event",
    id,
    event: {
      type: "tool.called",
      id: "t2",
      name: `mcp__ork__${tool}`,
      input: {},
    },
  },
  {
    type: "node.event",
    id,
    event: { type: "tool.result", id: "t2", isError: true, ...result },
  },
];

/** Node `id`'s `count` calls of `tool` that the driver's guard refused. */
const refused = (id: string, tool: string, count: number): RunEvent[] =>
  Array.from({ length: count }, (_, n): RunEvent[] => [
    {
      type: "node.event",
      id,
      event: {
        type: "tool.called",
        id: `r${String(n)}`,
        name: tool,
        input: {},
      },
    },
    {
      type: "node.event",
      id,
      event: {
        type: "tool.result",
        id: `r${String(n)}`,
        isError: true,
        fault: "refused",
        message: "Ork: Bash is not allowed for this node. Do not retry it.",
      },
    },
  ]).flat();

/** The records of `events`, observed with the run's scrubber. */
const scrubbed = (events: readonly RunEvent[]): FeedbackReport[] => {
  const signals = createSignals({ scrub: SCRUB });
  return reports(events.flatMap(event => signals(event)));
};

describe("system signals", () => {
  it("file arguments an Ork tool refused as the agent's context gap, not an Ork bug", () => {
    const recorded = reports(
      observe([
        ...RUN.slice(0, 3),
        ...toolCall("fix", "extract", {
          fault: "arguments",
          message: "Invalid arguments, nothing ran: steps must be an array",
        }),
        ...toolCall("fix", "follow_up", {
          fault: "arguments",
          message: "Invalid arguments, nothing ran: title is required",
        }),
      ]),
    );
    expect(recorded).toMatchObject([
      {
        code: "tool.arguments",
        kind: "context-gap",
        target: "workflow",
        title: "Ork's extract tool refused a call's arguments",
        evidence: [
          "mcp__ork__extract",
          "Invalid arguments, nothing ran: steps must be an array",
        ],
      },
      {
        code: "tool.arguments",
        title: "Ork's follow_up tool refused a call's arguments",
        evidence: [
          "mcp__ork__follow_up",
          "Invalid arguments, nothing ran: title is required",
        ],
      },
    ]);
  });

  it("give one record when two nodes are refused by the same tool", () => {
    const refusal = { fault: "arguments", message: "nothing ran" } as const;
    const recorded = reports(
      observe([
        ...toolCall("review", "extract", refusal),
        ...toolCall("engine", "extract", refusal),
      ]),
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.title).toBe(
      "Ork's extract tool refused a call's arguments",
    );
  });

  it("file a tool the driver's guard refused three times in one node, once", () => {
    const counts = [1, 2, 3, 4].map(
      count => reports(observe(refused("fix", "Bash", count))).length,
    );
    expect(counts).toEqual([0, 0, 1, 1]);
    const namesAllow: unknown = expect.stringContaining("`tools.allow`");
    expect(reports(observe(refused("fix", "Bash", 3)))).toEqual([
      expect.objectContaining({
        source: "system",
        code: "tool.refused",
        kind: "context-gap",
        target: "workflow",
        severity: "low",
        title: "Bash was refused repeatedly",
        body: namesAllow,
        evidence: ["Bash"],
      }),
    ]);
  });

  it("count refusals per node and tool, and give one record across nodes", () => {
    const spread = reports(
      observe([
        ...refused("fix", "Bash", 2),
        ...refused("review", "Bash", 2),
        ...refused("fix", "Edit", 2),
      ]),
    );
    expect(spread).toEqual([]);
    const both = reports(
      observe([...refused("fix", "Bash", 3), ...refused("review", "Bash", 3)]),
    );
    expect(both.map(r => r.code)).toEqual(["tool.refused"]);
  });

  it("keep an argument refusal as tool.arguments, and a guard's refusal out of tool.error", () => {
    const recorded = reports(
      observe([
        ...toolCall("fix", "extract", { fault: "arguments", message: "bad" }),
        ...toolCall("fix", "extract", { fault: "refused" }),
      ]),
    );
    expect(recorded.map(r => r.code)).toEqual(["tool.arguments"]);
  });

  it("keep the message of an Ork tool's error, and leave it out when there is none", () => {
    const [failed, bare] = [
      reports(observe(toolCall("fix", "extract", { message: "git failed" }))),
      reports(observe(toolCall("fix", "extract", {}))),
    ];
    expect(failed?.[0]).toMatchObject({
      code: "tool.error",
      title: "Ork's extract tool returned an error",
      evidence: ["mcp__ork__extract", "git failed"],
    });
    expect(bare?.[0]?.evidence).toEqual(["mcp__ork__extract"]);
  });

  it("keep a message's first line only, at most 300 characters", () => {
    const [long, lines] = [
      reports(
        observe(toolCall("fix", "extract", { message: "x".repeat(400) })),
      ),
      reports(observe(toolCall("fix", "extract", { message: "one\ntwo" }))),
    ];
    expect(long[0]?.evidence[1]).toHaveLength(300);
    expect(lines[0]?.evidence[1]).toBe("one");
  });

  it("mask a token and an env value in the message", () => {
    const token = `ghp_${"a1B2".repeat(9)}`;
    const message = `bad path ${token} and hunter2-and-more`;
    const recorded = [
      ...scrubbed(toolCall("fix", "extract", { fault: "arguments", message })),
      ...scrubbed(toolCall("fix", "extract", { message })),
    ];
    expect(recorded).toHaveLength(2);
    for (const one of recorded) {
      expect(JSON.stringify(one.evidence)).not.toContain(token);
      expect(JSON.stringify(one.evidence)).not.toContain("hunter2");
    }
  });

  it("come from the run's own events, once each, with their origin", () => {
    const recorded = reports(observe(RUN));
    expect(recorded.map(r => r.code)).toEqual([
      "tool.error",
      "permission.denied",
      "recommendation.overridden",
      "loop.exhausted",
      "gate.timeout",
      undefined,
      "budget.exhausted",
    ]);
    expect(recorded[0]).toMatchObject({
      source: "system",
      target: "ork",
      kind: "bug",
      title: "Ork's claim tool returned an error",
      origin: {
        workflow: "ship",
        workflowHash: "abc",
        nodeType: "agent.worker",
        model: "sonnet",
        driver: "claude-code",
        version: "1.2.3",
      },
    });
    expect(recorded[1]?.title).toBe("fix was denied Bash");
    expect(recorded[5]?.origin).toMatchObject({
      model: "sonnet",
      nodeType: "agent.worker",
    });
  });

  it("ignore an allowed tool and a recommended answer", () => {
    expect(reports(observe(answering("allow", "a"))).map(r => r.code)).toEqual([
      "tool.error",
    ]);
  });
});

describe("stored feedback", () => {
  it("groups records into items that can be dismissed", () => {
    const store = openStore(":memory:");
    for (const id of ["r1", "r2"]) {
      store.begin({
        id,
        workflow: "ship",
        file: "/p/ship.ork.yaml",
        project: "/p",
      });
      for (const event of observe(RUN)) store.append(id, event);
    }
    const items = store.feedbackItems();
    expect(items).toHaveLength(7);
    const loop = items.find(i => i.title.startsWith("The loop"));
    expect(loop).toMatchObject({
      status: "new",
      target: "workflow",
      kind: "workflow",
      severity: "medium",
      sources: ["system"],
      count: 2,
      runs: ["r1", "r2"],
      workflows: ["ship"],
    });
    const id = String(loop?.id);
    expect(store.findFeedback(id.slice(0, 6)).map(i => i.id)).toEqual([id]);
    expect(store.feedbackRecords(id).map(r => r.runId)).toEqual(["r1", "r2"]);
    expect(store.feedbackRecords(id)[0]?.feedback.origin).toMatchObject({
      workflow: "ship",
      version: "1.2.3",
    });
    expect(store.setFeedbackStatus(id, "dismissed")).toBe(true);
    expect(store.setFeedbackStatus("nope", "dismissed")).toBe(false);
    expect(store.feedbackItems().map(i => i.id)).not.toContain(id);
    expect(store.feedbackItems({ all: true })).toHaveLength(7);
    store.close();
  });

  it("hides a resolved item, and opens it again when it recurs after", () => {
    const store = openStore(":memory:");
    const record = (seq: number, at: string) =>
      store.importFeedback({
        runId: "r1",
        seq,
        at,
        feedback: {
          source: "system",
          kind: "workflow",
          target: "workflow",
          severity: "low",
          title: "build reached its turn limit",
          body: "",
          evidence: [],
          fingerprint: "turns",
          origin: {},
        },
      });
    record(1, "2026-01-01T00:00:00.000Z");
    expect(store.setFeedbackStatus("turns", "resolved")).toBe(true);
    expect(store.feedbackItems()).toEqual([]);
    expect(store.feedbackItems({ all: true })[0]?.status).toBe("resolved");
    // A record from before it was resolved (an import) leaves it resolved.
    record(2, "2026-01-02T00:00:00.000Z");
    expect(store.feedbackItems()).toEqual([]);
    record(3, "2099-01-01T00:00:00.000Z");
    expect(store.feedbackItems().map(i => [i.id, i.status])).toEqual([
      ["turns", "new"],
    ]);
    store.close();
  });
});
