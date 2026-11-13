/**
 * @file Tests for `ork resume`'s core: reading a run's events back (results up
 *   to the first failure, delegated runs left out, worktrees, loop answers, a
 *   leader's forks never taken for its session, by a resume or `ork chat`), and
 *   a resumed run that hands finished results back and runs the rest, keeping
 *   what a leader's forks spent.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  createReplay,
  type HumanChannel,
  type NodeExecutor,
  nodeSession,
  replayLoopAnswers,
  type RunEvent,
  resumeState,
  startRun,
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

/** A fans out to b and c, which join before d. */
const FAN = compile([
  "nodes:",
  "  a: { type: tool.shell, command: a }",
  "  b: { type: tool.shell, command: b }",
  "  c: { type: tool.shell, command: c }",
  "  j: { type: control.join }",
  "  d: { type: tool.shell, command: d }",
  "edges:",
  "  - a -> b, c",
  "  - b, c -> j",
  "  - j -> d",
]);

const human: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "stop"),
  permit: () => Promise.resolve({ allow: true }),
};

/** Runs FAN; `failing` nodes exit 1. Returns its events and what ran. */
const runFan = async (
  failing: readonly string[],
  replay?: ReturnType<typeof createReplay>,
) => {
  const ran: string[] = [];
  const shell: NodeExecutor = ({ id }) => {
    ran.push(id);
    const exitCode = failing.includes(id) ? 1 : 0;
    return Promise.resolve({
      ok: exitCode === 0,
      output: { exitCode, stdout: `${id} out`, stderr: "" },
    });
  };
  const events: RunEvent[] = [];
  const { done } = startRun({
    graph: FAN,
    inputs: { feature: "x" },
    cwd: import.meta.dirname,
    executors: { "tool.shell": shell },
    human,
    settings: { inPlace: true },
    onEvent: event => {
      events.push(event);
    },
    ...(replay === undefined ? {} : { replay }),
  });
  return { result: await done, events, ran };
};

const started = (events: RunEvent[]) =>
  events.flatMap(e => (e.type === "node.started" ? [e.id] : []));

describe("a resumed run", () => {
  it("hands back what finished, and runs the failed node and all it feeds", async () => {
    const first = await runFan(["c"]);
    expect(first.result.status).toBe("failed");
    const state = resumeState(first.events);
    expect(state.inputs).toEqual({ feature: "x" });
    expect(state.settings).toEqual({ inPlace: true });
    // The join went on with b alone, so j and d finished too.
    expect([...state.history.keys()].toSorted()).toEqual(["a", "b", "d", "j"]);

    const replay = createReplay(state.history);
    const again = await runFan([], replay);
    expect(again.result.status).toBe("succeeded");
    expect(again.ran).toEqual(["c", "d"]);
    expect(started(again.events)).toEqual(["c", "j", "d"]);
    // a and b were handed back whole: kept, not counted as ran.
    expect(again.result.kept).toBe(2);
    expect(first.result.kept).toBeUndefined();
    expect(again.result.nodes.map(n => n.id).toSorted()).toEqual([
      "a",
      "b",
      "c",
      "d",
      "j",
    ]);
  });

  it("keeps what a fork spent, in the run and against the node it forked", async () => {
    const first = await runFan(["c"]);
    // A fork of a's session answered a question before the run failed.
    const events: RunEvent[] = [
      ...first.events.slice(0, -1),
      forkFinished("a", 0.5),
      ...first.events.slice(-1),
    ];
    const state = resumeState(events);
    expect(state.earlier.total).toBe(0.5);

    const replay = createReplay(
      state.history,
      state.cutOff,
      undefined,
      state.earlier,
    );
    const again = await runFan([], replay);
    expect(again.result.costUsd).toBe(0.5);
    expect(again.result.nodes.find(n => n.id === "a")?.costUsd).toBe(0.5);
    const sum = again.result.nodes.reduce((all, n) => all + n.costUsd, 0);
    expect(sum).toBe(again.result.costUsd);
  });
});

/** A fork of `id`'s session, as recorded under `id`. */
const forkStarted = (id: string): RunEvent => ({
  type: "node.event",
  id,
  event: {
    type: "session.started",
    sessionId: `${id}-fork`,
    model: "m",
    cwd: "/fork",
    fork: true,
  },
});

/** The end of a fork of `id`'s session, at `costUsd`. */
const forkFinished = (id: string, costUsd: number): RunEvent => ({
  type: "node.event",
  id,
  event: {
    type: "session.finished",
    fork: true,
    outcome: {
      subtype: "success",
      sessionId: `${id}-fork`,
      report: null,
      text: "",
      usage: {
        costUsd,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        turns: 1,
        durationMs: 1,
      },
      errors: [],
    },
  },
});

describe("a leader's fork", () => {
  /** A leader cut off in `delegate`, after its fork answered a question. */
  const cut: RunEvent[] = [
    { type: "node.started", id: "lead", nodeType: "agent.leader", round: 1 },
    {
      type: "node.event",
      id: "lead",
      event: {
        type: "session.started",
        sessionId: "lead-s1",
        model: "m",
        cwd: "/lead",
      },
    },
    forkStarted("lead"),
    {
      type: "node.event",
      id: "lead",
      event: { type: "assistant.text", text: "b, as planned.", fork: true },
    },
    forkFinished("lead", 0.5),
  ];

  it("is never the session a resume continues", () => {
    expect([...resumeState(cut).cutOff]).toEqual([["lead", "lead-s1"]]);
  });

  it("is never the session `ork chat` takes", () => {
    const stored = cut.map((event, index) => ({
      runId: "r1",
      seq: index + 1,
      at: "2026-11-08T00:00:00.000Z",
      event,
    }));
    const { session } = nodeSession(stored, "lead");
    expect(session).toMatchObject({ sessionId: "lead-s1", cwd: "/lead" });
  });
});

/** A flow run of `id` that finished ok, with its session. */
const ok = (id: string, round: number): RunEvent[] => [
  { type: "node.started", id, nodeType: "agent.worker", round },
  {
    type: "node.event",
    id,
    event: {
      type: "session.started",
      sessionId: `${id}-s${String(round)}`,
      model: "m",
    },
  },
  {
    type: "node.finished",
    id,
    round,
    ok: true,
    output: { status: "pass" },
  },
];
/** A worktree event for `id`. */
const tree = (
  id: string,
  action: "created" | "merged" | "removed",
): RunEvent => ({
  type: "worktree",
  id,
  action,
  path: `/w/${id}`,
  branch: `ork/r/${id}`,
});
describe("reading a run's events back", () => {
  it("keeps results up to a node's first failure or unfinished run", () => {
    const state = resumeState([
      ...ok("lead", 1),
      ...ok("lead", 2),
      // A delegated run belongs to its leader.
      {
        type: "node.started",
        id: "kid",
        nodeType: "agent.worker",
        round: 1,
        owner: "lead",
      },
      { type: "node.finished", id: "kid", round: 1, ok: true, output: {} },
      { type: "node.started", id: "fix", nodeType: "agent.worker", round: 1 },
      { type: "node.finished", id: "fix", round: 1, ok: false, output: {} },
      ...ok("fix", 2),
      { type: "node.started", id: "cut", nodeType: "agent.worker", round: 1 },
    ]);
    expect(state.history.get("lead")?.map(r => r.sessionId)).toEqual([
      "lead-s1",
      "lead-s2",
    ]);
    expect(state.history.has("kid")).toBe(false);
    expect(state.history.has("fix")).toBe(false);
    expect(state.history.has("cut")).toBe(false);
  });

  it("continues a node's session once when the run was cut off, not when it failed", () => {
    const cutRun: RunEvent[] = [
      { type: "node.started", id: "cut", nodeType: "agent.worker", round: 1 },
      {
        type: "node.event",
        id: "cut",
        event: { type: "session.started", sessionId: "cut-s1", model: "haiku" },
      },
    ];
    const crashed = resumeState(cutRun);
    expect([...crashed.cutOff]).toEqual([["cut", "cut-s1"]]);
    const replay = createReplay(crashed.history, crashed.cutOff);
    const activation = { id: "cut", input: undefined };
    expect(replay.cutOff?.(activation)).toBe("cut-s1");
    expect(replay.cutOff?.(activation)).toBeUndefined();

    const failed = resumeState([
      ...cutRun,
      { type: "node.finished", id: "cut", round: 1, ok: false, output: {} },
      {
        type: "run.finished",
        result: {
          runId: "r1",
          status: "failed",
          costUsd: 0,
          nodes: [],
          reasons: [],
          worktrees: [],
        },
      },
    ]);
    expect(failed.cutOff.size).toBe(0);
  });

  it("rebuilds unread messages and the user's queued ones for the resumed bus", () => {
    const state = resumeState([
      { type: "message.sent", node: "a", to: "b", message: 1, body: "one" },
      { type: "message.sent", node: "a", to: "b", message: 2, body: "two" },
      { type: "message.read", node: "b", ids: [1] },
      { type: "user.message", node: "c", body: "hi", delivered: "queued" },
      { type: "user.message", node: "b", body: "seen", delivered: "queued" },
      { type: "node.started", id: "b", nodeType: "agent.worker", round: 2 },
    ]);
    expect(state.mail.last).toBe(2);
    expect(state.mail.inboxes.get("b")).toEqual([
      { id: 2, from: "a", body: "two" },
    ]);
    expect([...state.mail.waiting]).toEqual([["c", ["hi"]]]);
    expect(createReplay(state.history, state.cutOff, state.mail).mail).toBe(
      state.mail,
    );
  });

  it("keeps worktrees that were not removed, and loop answers", async () => {
    const state = resumeState([
      tree("lead", "created"),
      tree("fix", "created"),
      tree("fix", "merged"),
      tree("old", "created"),
      tree("old", "removed"),
      { type: "loop.exhausted", from: "reviews", to: "lead", maxRounds: 2 },
      {
        type: "decision.opened",
        node: "reviews",
        decision: "r-1",
        kind: "question",
        question:
          "The loop reviews -> lead used all 2 of its rounds. What now?",
        options: [],
      },
      {
        type: "decision.answered",
        node: "reviews",
        decision: "r-1",
        answer: "again",
        by: "decide",
      },
      {
        type: "decision.opened",
        node: "gate",
        decision: "r-2",
        kind: "question",
        question: "Merge?",
        options: [],
      },
      {
        type: "decision.answered",
        node: "gate",
        decision: "r-2",
        answer: "yes",
        by: "terminal",
      },
    ]);
    expect(state.worktrees).toEqual([
      { id: "lead", path: "/w/lead", branch: "ork/r/lead", merged: false },
      { id: "fix", path: "/w/fix", branch: "ork/r/fix", merged: true },
    ]);
    expect(state.loopAnswers).toEqual([
      {
        question:
          "The loop reviews -> lead used all 2 of its rounds. What now?",
        answer: "again",
      },
    ]);
    const asked = replayLoopAnswers(human, state.loopAnswers);
    const loop = {
      nodeId: "reviews",
      question: "The loop reviews -> lead used all 2 of its rounds. What now?",
      options: [{ id: "stop" }, { id: "again" }],
      recommended: "stop",
    };
    expect(await asked.ask(loop)).toBe("again");
    expect(await asked.ask(loop)).toBe("stop");
  });
});
