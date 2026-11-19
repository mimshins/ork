/**
 * @file Tests for the `sessions.freshOver` rule in the scheduler: a delegated
 *   `session: resume` worker whose last session ended `done` over the threshold
 *   starts its next task fresh, with `fresh` on its `node.started` and a note
 *   of its earlier tasks in its context; at or under it, unset, `never`, a loop
 *   re-entry, an end other than `done` and a child leader resume as before;
 *   spend counts the fresh session whole; and `ork resume` adds no `fresh`.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  createReplay,
  type NodeExecutor,
  type NodeResult,
  type RunEvent,
  resumeState,
  type SessionUsage,
  startRun,
} from "../src/index.ts";
import { freshStart } from "../src/run/fresh-session.ts";

const compile = (lines: string[]): CompiledGraph => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const usageOf = (costUsd: number, contextTokens?: number): SessionUsage => ({
  costUsd,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 0,
  ...(contextTokens === undefined ? {} : { contextTokens }),
});

/** What a builder's session gives: its id, cost, context, and whether done. */
type Leg = { costUsd?: number; contextTokens?: number; ok?: boolean };

const resultOf = (sessionId: string, leg: Leg): NodeResult => {
  const ok = leg.ok ?? true;
  return {
    ok,
    output: { status: ok ? "pass" : "fail", summary: "did" },
    ...(ok ? {} : { error: "the task failed" }),
    usage: usageOf(leg.costUsd ?? 0, leg.contextTokens),
    sessionId,
  };
};

/** A leader `lead` over `fix`, with the rule set to `freshOver` if given. */
const team = (
  freshOver?: string,
  fix = "type: agent.worker, session: resume",
) =>
  compile([
    ...(freshOver === undefined
      ? []
      : [`rules: { sessions: { freshOver: ${freshOver} } }`]),
    "nodes:",
    "  lead: { type: agent.leader }",
    `  fix: { ${fix}, parent: lead }`,
  ]);

type TeamRun = {
  briefs?: readonly string[];
  replay?: ReturnType<typeof createReplay>;
  /** The leader fails after its tasks, so a resume runs it again. */
  leadFails?: boolean;
};

/**
 * Runs `graph`: `lead` delegates `fix` each of `briefs` in turn; `fix`'s n-th
 * session gives `legs[n]`, in the session it resumes or a new `s<n>`.
 */
const runTeam = async (
  graph: CompiledGraph,
  legs: readonly Leg[],
  { briefs = ["one", "two"], replay, leadFails = false }: TeamRun = {},
) => {
  const seen: string[] = [];
  const notes: (string | undefined)[] = [];
  const events: RunEvent[] = [];
  const executor: NodeExecutor = async context => {
    if (context.id === "lead") {
      // One task at a time: each waits for the one before to report.
      await briefs.reduce<Promise<unknown>>(
        (before, brief) =>
          before.then(() =>
            context.ownership?.delegate([{ child: "fix", brief }]),
          ),
        Promise.resolve(),
      );
      return resultOf("lead-session", { ok: !leadFails });
    }
    seen.push(`${String(context.brief?.text)} ${String(context.resume)}`);
    notes.push(context.handover);
    const sessionId = context.resume ?? `s${String(seen.length)}`;
    return resultOf(sessionId, legs[seen.length - 1] ?? {});
  };
  const result = await startRun({
    graph,
    inputs: {},
    cwd: process.cwd(),
    executors: { "agent.leader": executor, "agent.worker": executor },
    human: {
      ask: () => Promise.resolve("stop"),
      permit: () => Promise.resolve({ allow: true }),
    },
    onEvent: event => {
      events.push(event);
    },
    ...(replay === undefined ? {} : { replay }),
  }).done;
  return { result, events, seen, notes };
};

/** Each `node.started` of `fix`: its `fresh`, absent when it has none. */
const freshOf = (events: readonly RunEvent[]) =>
  events.flatMap(e =>
    e.type === "node.started" && e.id === "fix"
      ? [Object.hasOwn(e, "fresh") ? e.fresh : "none"]
      : [],
  );

const OVER = [{ contextTokens: 150_000 }, {}];

describe("a delegated builder's next task", () => {
  it("starts fresh when its done session's context is over the rule", async () => {
    const { seen, events } = await runTeam(team("100000"), OVER);
    expect(seen).toEqual(["one undefined", "two undefined"]);
    expect(freshOf(events)).toEqual([
      "none",
      { contextTokens: 150_000, over: 100_000 },
    ]);
  });

  it("hands the fresh session a note of its earlier tasks, newest first", async () => {
    const legs = [{ contextTokens: 150_000 }, { contextTokens: 150_000 }, {}];
    const { notes } = await runTeam(team("100000"), legs, {
      briefs: ["one", "two", "three"],
    });
    expect(notes[0]).toBeUndefined();
    expect(notes[2]).toMatch(
      /^## Your earlier tasks in this run\n\n[^#]+### two \(pass\)\n\ndid\n\n### one \(pass\)\n\ndid$/u,
    );
  });

  it("gives a resumed session no note", async () => {
    const { notes } = await runTeam(team("never"), OVER);
    expect(notes).toEqual([undefined, undefined]);
  });

  it("resumes at or under the rule, with no figure, or with the rule never or unset", async () => {
    const resumed = ["one undefined", "two s1"];
    const at = [{ contextTokens: 100_000 }, {}];
    expect((await runTeam(team("100000"), at)).seen).toEqual(resumed);
    expect((await runTeam(team("100000"), [{}, {}])).seen).toEqual(resumed);
    expect((await runTeam(team("never"), OVER)).seen).toEqual(resumed);
    const unset = await runTeam(team(), OVER);
    expect(unset.seen).toEqual(resumed);
    expect(freshOf(unset.events)).toEqual(["none", "none"]);
  });

  it("resumes when its last session did not end done, whatever its context", async () => {
    const failed = [{ contextTokens: 150_000, ok: false }, {}];
    const { seen } = await runTeam(team("100000"), failed);
    expect(seen).toEqual(["one undefined", "two s1"]);
  });

  it("resumes a child leader over the rule", async () => {
    const graph = team("100000", "type: agent.leader");
    const { seen } = await runTeam(graph, OVER);
    expect(seen).toEqual(["one undefined", "two s1"]);
  });

  it("counts the fresh session's whole cost, and keeps the old one's total", async () => {
    const legs = [{ contextTokens: 150_000, costUsd: 2 }, { costUsd: 3 }];
    expect((await runTeam(team("100000"), legs)).result.costUsd).toBe(5);
    // Resumed, the same session's total of 3 holds 2 already counted.
    expect((await runTeam(team("never"), legs)).result.costUsd).toBe(3);
  });
});

/** `review` sends `build` back once; every session's context is 500. */
const looping =
  (seen: string[]): NodeExecutor =>
  context => {
    seen.push(`${context.id} ${String(context.resume)}`);
    const again = context.id === "review" && context.round === 1;
    return Promise.resolve({
      ...resultOf(context.resume ?? `${context.id}-s`, { contextTokens: 500 }),
      output: { status: "pass", summary: again ? "again" : "ok" },
    });
  };

describe("a loop re-entry over the rule", () => {
  it("still resumes its session", async () => {
    const graph = compile([
      "rules: { sessions: { freshOver: 10 } }",
      "nodes:",
      "  build: { type: agent.worker, session: resume }",
      "  review: { type: agent.worker }",
      "edges:",
      "  - build -> review",
      "  - { from: review, to: build, when: \"summary == 'again'\", maxRounds: 1 }",
    ]);
    const seen: string[] = [];
    const result = await startRun({
      graph,
      inputs: {},
      cwd: process.cwd(),
      executors: { "agent.worker": looping(seen) },
      human: {
        ask: () => Promise.resolve("stop"),
        permit: () => Promise.resolve({ allow: true }),
      },
      onEvent: () => {},
    }).done;
    expect(result.status).toBe("succeeded");
    expect(seen).toEqual([
      "build undefined",
      "review undefined",
      "build build-s",
      "review undefined",
    ]);
  });
});

/** The events with every `contextTokens` gone, as a run before the rule. */
const recordedBefore = (events: readonly RunEvent[]): RunEvent[] =>
  events.map(event =>
    event.type === "node.finished" && event.usage !== undefined
      ? { ...event, usage: usageOf(event.usage.costUsd) }
      : event,
  );

describe("a resumed run", () => {
  it.each([
    ["recorded with the figure", (events: RunEvent[]) => events],
    ["recorded before the rule", recordedBefore],
  ])("adds no fresh to a delegated builder, %s", async (_, recorded) => {
    const first = await runTeam(team("100000"), OVER, {
      briefs: ["one"],
      leadFails: true,
    });
    expect(first.result.status).toBe("failed");
    const state = resumeState(recorded(first.events));
    const again = await runTeam(team("100000"), OVER, {
      briefs: ["two"],
      replay: createReplay(state.history, state.cutOff),
    });
    expect(again.result.status).toBe("succeeded");
    expect(again.seen).toEqual(["two undefined"]);
    expect(freshOf(again.events)).toEqual(["none"]);
  });
});

describe("freshStart", () => {
  const worker = { type: "agent.worker", session: "resume" } as const;
  const done = { kind: "done", contextTokens: 200 } as const;

  it("decides from the brief, the session, the end, the figure and the rule", () => {
    const facts = {
      node: worker,
      delegated: true,
      sessionId: "s1",
      last: done,
      freshOver: 100,
    };
    expect(freshStart(facts)).toEqual({ contextTokens: 200, over: 100 });
    expect(freshStart({ ...facts, delegated: false })).toBeUndefined();
    expect(freshStart({ ...facts, sessionId: undefined })).toBeUndefined();
    expect(freshStart({ ...facts, freshOver: "never" })).toBeUndefined();
    expect(freshStart({ ...facts, freshOver: undefined })).toBeUndefined();
    expect(freshStart({ ...facts, freshOver: 200 })).toBeUndefined();
    expect(
      freshStart({
        ...facts,
        last: { kind: "turn_limit", contextTokens: 200 },
      }),
    ).toBeUndefined();
    expect(
      freshStart({ ...facts, node: { type: "agent.worker" } }),
    ).toBeUndefined();
  });
});
