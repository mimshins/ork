/**
 * @file Tests for `ork resume`'s core: reading a run's events back (results up
 *   to the first failure, delegated runs left out, worktrees, loop answers),
 *   and a resumed run that hands finished results back and runs the rest.
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
    expect(again.result.nodes.map(n => n.id).toSorted()).toEqual([
      "a",
      "b",
      "c",
      "d",
      "j",
    ]);
  });
});

/** A flow run of `id` that finished ok, with its session. */
const ok = (id: string, round: number): RunEvent[] => [
  { type: "node.started", id, nodeType: "claude.worker", round },
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
        nodeType: "claude.worker",
        round: 1,
        owner: "lead",
      },
      { type: "node.finished", id: "kid", round: 1, ok: true, output: {} },
      { type: "node.started", id: "fix", nodeType: "claude.worker", round: 1 },
      { type: "node.finished", id: "fix", round: 1, ok: false, output: {} },
      ...ok("fix", 2),
      { type: "node.started", id: "cut", nodeType: "claude.worker", round: 1 },
    ]);
    expect(state.history.get("lead")?.map(r => r.sessionId)).toEqual([
      "lead-s1",
      "lead-s2",
    ]);
    expect(state.history.has("kid")).toBe(false);
    expect(state.history.has("fix")).toBe(false);
    expect(state.history.has("cut")).toBe(false);
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
