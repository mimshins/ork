/**
 * @file Tests for a changed driver (specs/scheduler/fresh-sessions.md): a node
 *   set to resume whose session started on another driver than the one its
 *   model now names starts fresh, with `driverChanged` on its `node.started`
 *   and, when delegated, the handover note; within one driver it resumes. Also
 *   an item's model prefix in a loop round, and `ork resume` reading the
 *   earlier driver back from the run's events (or resuming as before when the
 *   run did not record one).
 */

import { type Driver, parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  createReplay,
  type NodeExecutor,
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

type Seen = {
  id: string;
  round: number;
  resume?: string;
  handover?: string;
  /** The model `pick` reported before this activation. */
  picked?: string;
};

/**
 * A stub driver: `lead` delegates `fix` two tasks; a `check` asks for one more
 * round; `pick` reports the model its prompt lists for the round; any other
 * node starts or resumes a session, reported on `driver` (`null`: a run from
 * before drivers were recorded).
 */
const stub = (driver: Driver | null, seen: Seen[]): NodeExecutor => {
  let checks = 0;
  return async context => {
    if (context.id === "lead") {
      await context.ownership?.delegate([{ child: "fix", brief: "one" }]);
      await context.ownership?.delegate([{ child: "fix", brief: "two" }]);
      return { ok: true, output: { status: "pass", summary: "led" } };
    }
    if (context.id === "check") {
      checks += 1;
      return { ok: true, output: { again: checks === 1 } };
    }
    if (context.id === "pick") {
      // Its prompt lists the model it reports in each round.
      const prompt = "prompt" in context.node ? context.node.prompt : "";
      const model = (prompt ?? "").split(" ")[context.round - 1] ?? "";
      return { ok: true, output: { model } };
    }
    const picked = context.outputs["pick"]?.["model"];
    seen.push({
      id: context.id,
      round: context.round,
      ...(typeof picked === "string" ? { picked } : {}),
      ...(context.resume === undefined ? {} : { resume: context.resume }),
      ...(context.handover === undefined ? {} : { handover: context.handover }),
    });
    const sessionId =
      context.resume ?? `s-${context.id}-${String(context.round)}`;
    context.emit({
      type: "session.started",
      sessionId,
      model: "m",
      ...(driver === null ? {} : { driver }),
    });
    return {
      ok: true,
      output: { status: "pass", summary: "did" },
      sessionId,
    };
  };
};

const play = async (
  graph: CompiledGraph,
  driver: Driver | null,
  recorded?: readonly RunEvent[],
) => {
  const state = recorded === undefined ? undefined : resumeState(recorded);
  const seen: Seen[] = [];
  const events: RunEvent[] = [];
  const executor = stub(driver, seen);
  await startRun({
    graph,
    inputs: {},
    cwd: process.cwd(),
    executors: {
      "agent.worker": executor,
      "agent.leader": executor,
      "tool.shell": executor,
    },
    human: {
      ask: () => Promise.resolve("stop"),
      permit: () => Promise.resolve({ allow: true }),
    },
    onEvent: event => {
      events.push(event);
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
            state.drivers,
          ),
        }),
  }).done;
  return { seen, events };
};

/** The session each activation resumed, or "fresh". */
const resumesOf = (all: readonly Seen[]) =>
  all.map(one => one.resume ?? "fresh");

/** Each `node.started` of `id`: its `driverChanged`, or "none". */
const changesOf = (events: readonly RunEvent[], id: string) =>
  events.flatMap(e =>
    e.type === "node.started" && e.id === id
      ? [Object.hasOwn(e, "driverChanged") ? e.driverChanged : "none"]
      : [],
  );

/** The events up to and including `id`'s start in `round`: a crash there. */
const crashAt = (events: readonly RunEvent[], id: string, round: number) =>
  events.slice(
    0,
    events.findIndex(
      e => e.type === "node.started" && e.id === id && e.round === round,
    ) + 1,
  );

/** A leader `lead` over a resuming `fix` on `claude-code.opus`. */
const TEAM = compile([
  "nodes:",
  "  lead: { type: agent.leader }",
  "  fix:",
  "    type: agent.worker",
  "    session: resume",
  "    parent: lead",
  "    model: claude-code.opus",
]);

/** A resuming item whose model names its driver, in a loop of two rounds. */
const LOOP = compile([
  "nodes:",
  "  build:",
  "    type: agent.worker",
  "    session: resume",
  "    prompt: do it",
  '    model: "{{item.model}}"',
  "    forEach: { items: [{ model: claude-code.opus }] }",
  "  check:",
  "    type: tool.shell",
  "    command: x",
  "edges:",
  "  - build -> check",
  "  - { from: check, to: build, when: output.again, maxRounds: 1 }",
]);

/**
 * A resuming `build` whose model `pick` reports anew each round of a loop:
 * `models`, one per round.
 */
const PICKED = (models: string) =>
  compile([
    "nodes:",
    "  pick:",
    "    type: agent.worker",
    `    prompt: ${models}`,
    "    output: { schema: { model: string } }",
    "  build:",
    "    type: agent.worker",
    "    session: resume",
    "    prompt: do it",
    '    model: "{{nodes.pick.output.model}}"',
    "  check:",
    "    type: tool.shell",
    "    command: x",
    "edges:",
    "  - pick -> build",
    "  - build -> check",
    "  - { from: check, to: pick, when: output.again, maxRounds: 1 }",
  ]);

describe("a model read from an earlier output that changes", () => {
  it("resumes across a model change within one driver", async () => {
    const graph = PICKED("claude-code.opus claude-code.sonnet");
    const { seen, events } = await play(graph, "claude-code");
    const builds = seen.filter(s => s.id === "build");
    expect(builds.map(s => s.picked)).toEqual([
      "claude-code.opus",
      "claude-code.sonnet",
    ]);
    expect(resumesOf(builds)).toEqual(["fresh", "s-build-1"]);
    expect(changesOf(events, "build")).toEqual(["none", "none"]);
  });

  it("starts fresh when the model it read names another driver", async () => {
    const graph = PICKED("claude-code.opus open-code.big");
    const { seen, events } = await play(graph, "claude-code");
    const builds = seen.filter(s => s.id === "build");
    expect(resumesOf(builds)).toEqual(["fresh", "fresh"]);
    expect(changesOf(events, "build")).toEqual([
      "none",
      { from: "claude-code", to: "open-code" },
    ]);
  });
});

describe("a delegated task whose driver changed", () => {
  it("resumes when its session started on the same driver", async () => {
    const { seen, events } = await play(TEAM, "claude-code");
    expect(resumesOf(seen)).toEqual(["fresh", "s-fix-1"]);
    expect(changesOf(events, "fix")).toEqual(["none", "none"]);
  });

  it("starts fresh, with the marker and the handover note", async () => {
    const { seen, events } = await play(TEAM, "open-code");
    expect(resumesOf(seen)).toEqual(["fresh", "fresh"]);
    expect(changesOf(events, "fix")).toEqual([
      "none",
      { from: "open-code", to: "claude-code" },
    ]);
    expect(seen[1]?.handover).toContain("one");
  });

  it("resumes as before when the session's driver was not recorded", async () => {
    const { seen } = await play(TEAM, null);
    expect(resumesOf(seen)).toEqual(["fresh", "s-fix-1"]);
  });
});

describe("an item's model prefix in a loop round", () => {
  it("resumes the item's session on the same driver", async () => {
    const { seen, events } = await play(LOOP, "claude-code");
    expect(resumesOf(seen)).toEqual(["fresh", "s-build.0-1"]);
    expect(changesOf(events, "build.0")).toEqual(["none", "none"]);
  });

  it("starts the item fresh when its session ran on another driver", async () => {
    const { seen, events } = await play(LOOP, "open-code");
    expect(resumesOf(seen)).toEqual(["fresh", "fresh"]);
    expect(changesOf(events, "build.0")).toEqual([
      "none",
      { from: "open-code", to: "claude-code" },
    ]);
  });
});

describe("ork resume", () => {
  it("reads the earlier session's driver back from the run", async () => {
    const first = await play(LOOP, "open-code");
    const crash = crashAt(first.events, "build.0", 2);
    expect(resumeState(crash).drivers.get("s-build.0-1")).toBe("open-code");
    const { seen, events } = await play(LOOP, "claude-code", crash);
    expect(resumesOf(seen)).toEqual(["fresh"]);
    expect(changesOf(events, "build.0")).toEqual([
      { from: "open-code", to: "claude-code" },
    ]);
  });

  it("resumes when the earlier session ran on the same driver", async () => {
    const first = await play(LOOP, "claude-code");
    const crash = crashAt(first.events, "build.0", 2);
    const { seen, events } = await play(LOOP, "claude-code", crash);
    expect(resumesOf(seen)).toEqual(["s-build.0-1"]);
    expect(changesOf(events, "build.0")).toEqual(["none"]);
  });

  it("resumes as before a run that recorded no driver", async () => {
    const first = await play(LOOP, null);
    const crash = crashAt(first.events, "build.0", 2);
    const { seen } = await play(LOOP, "claude-code", crash);
    expect(resumesOf(seen)).toEqual(["s-build.0-1"]);
  });
});
