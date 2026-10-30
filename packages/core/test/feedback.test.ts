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
  openStore,
  type RunEvent,
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

const GRAPH = compile(["nodes:", "  fix: { type: claude.worker, prompt: f }"]);

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
      origin: { nodeType: "claude.worker" },
    });
    // A new session has its own cap; the run still drops duplicates.
    expect(
      feedback.port("fix").report({ kind: "idea", title: "five" }),
    ).toMatchObject({ ok: true });
    expect(reports(events)).toHaveLength(4);
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
  { type: "node.started", id: "fix", nodeType: "claude.worker", round: 1 },
  {
    type: "node.event",
    id: "fix",
    event: {
      type: "session.started",
      sessionId: "s",
      model: "sonnet",
      driver: "cli",
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
      origin: { nodeType: "claude.worker" },
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

describe("system signals", () => {
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
        nodeType: "claude.worker",
        model: "sonnet",
        driver: "cli",
        version: "1.2.3",
      },
    });
    expect(recorded[1]?.title).toBe("fix was denied Bash");
    expect(recorded[5]?.origin).toMatchObject({
      model: "sonnet",
      nodeType: "claude.worker",
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
});
