/**
 * @file Tests for `forEach` in the scheduler (RFC-013) on scripted executors:
 *   lists, gathering in order, pacing, failure, limits, stop, pause, loops,
 *   what a leader is offered, claims, and what the store keeps of a list.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  type ExecuteContext,
  type HumanChannel,
  type NodeExecutor,
  type NodeExecutors,
  type NodeResult,
  openStore,
  parseTemplate,
  renderTemplate,
  type RunEvent,
  type RunHandle,
  runScope,
  startRun,
  type Workspace,
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

const fanned = (
  forEach: string,
  extra: string[] = [],
  after: string[] = [],
): CompiledGraph =>
  compile([
    ...extra,
    "nodes:",
    "  build:",
    "    type: tool.shell",
    "    command: echo x",
    `    forEach: ${forEach}`,
    ...after,
  ]);

const workers = (forEach: string, extra: string[] = []): CompiledGraph =>
  compile([
    ...extra,
    "nodes:",
    "  build:",
    "    type: claude.worker",
    "    prompt: do it",
    `    forEach: ${forEach}`,
  ]);

const fromPlan = (): CompiledGraph =>
  compile([
    "nodes:",
    "  plan:",
    "    type: tool.shell",
    "    command: x",
    "  build:",
    "    type: tool.shell",
    "    command: echo x",
    "    forEach:",
    '      from: "{{nodes.plan.output.tasks}}"',
    "      maxItems: 3",
    "edges:",
    "  - plan -> build",
  ]);

const withFannedChild = (leaderLines: string[] = []): CompiledGraph =>
  compile([
    "nodes:",
    "  start:",
    "    type: tool.shell",
    "    command: x",
    "  lead:",
    "    type: claude.leader",
    "    prompt: lead",
    ...leaderLines,
    "  code:",
    "    type: claude.worker",
    "    parent: lead",
    "    prompt: code",
    "  build:",
    "    type: claude.worker",
    "    parent: lead",
    "    prompt: do it",
    "    forEach: { items: [a] }",
    "edges:",
    "  - start -> build",
  ]);

const pass = (summary = "ok", cost = 0): NodeResult => ({
  ok: true,
  output: { status: "pass", summary },
  usage: {
    costUsd: cost,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turns: 1,
    durationMs: 0,
  },
});

const fail = (error: string): NodeResult => ({
  ok: false,
  output: { status: "fail", summary: error },
  error,
});

const tick = (ms = 1) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const until = async (test: () => boolean): Promise<void> => {
  while (!test()) {
    // oxlint-disable-next-line no-await-in-loop -- polling a fake
    await tick();
  }
};

const human: HumanChannel = {
  ask: () => Promise.resolve("stop"),
  permit: () => Promise.resolve({ allow: true }),
};

const allTypes = (executor: NodeExecutor): NodeExecutors => ({
  "claude.leader": executor,
  "claude.worker": executor,
  "tool.shell": executor,
  "mcp.call": executor,
  "workflow.call": executor,
});

const begin = (
  graph: CompiledGraph,
  executor: NodeExecutor,
  workspace?: Workspace,
) => {
  const events: RunEvent[] = [];
  const handle = startRun({
    graph,
    inputs: {},
    cwd: process.cwd(),
    executors: allTypes(executor),
    human,
    runId: "r1",
    onEvent: event => {
      events.push(event);
    },
    ...(workspace === undefined ? {} : { workspace }),
  });
  return { handle, events };
};

const run = async (
  graph: CompiledGraph,
  executor: NodeExecutor,
  workspace?: Workspace,
) => {
  const { handle, events } = begin(graph, executor, workspace);
  const result = await handle.done;
  return { result, events };
};

type Finished = Extract<RunEvent, { type: "node.finished" }>;
type Listed = Extract<RunEvent, { type: "each.listed" }>;

const finishedOf = (events: readonly RunEvent[], id: string): Finished => {
  const found = events.find(
    (event): event is Finished =>
      event.type === "node.finished" && event.id === id,
  );
  if (found === undefined) throw new Error(`${id} did not finish`);
  return found;
};

const started = (events: readonly RunEvent[]): string[] =>
  events.flatMap(event => (event.type === "node.started" ? [event.id] : []));

const hasStarted = (events: readonly RunEvent[], id: string): boolean =>
  started(events).includes(id);

const startedEventOf = (events: readonly RunEvent[], id: string) =>
  events.find(event => event.type === "node.started" && event.id === id);

const listed = (events: readonly RunEvent[]): Listed[] =>
  events.filter((event): event is Listed => event.type === "each.listed");

const bracket = (events: readonly RunEvent[]): string[] =>
  events.flatMap(event =>
    event.type === "node.started" || event.type === "node.finished"
      ? [`${event.type} ${event.id}`]
      : [],
  );

const sentBy = (events: readonly RunEvent[]) =>
  events.flatMap(event =>
    event.type === "message.sent" ? [[event.node, event.body]] : [],
  );

/** Each item's summary: its id and what it was handed. */
const echo: NodeExecutor = context =>
  Promise.resolve(pass(`${context.id}=${String(context.item?.value)}`));

/** Which executor runs which id; the rest pass. */
const byId =
  (
    cases: Record<string, NodeExecutor>,
    rest: NodeExecutor = () => Promise.resolve(pass()),
  ): NodeExecutor =>
  context =>
    (cases[context.id] ?? rest)(context);

const planned = (tasks: unknown): NodeExecutor =>
  byId({ plan: () => Promise.resolve({ ok: true, output: { tasks } }) }, echo);

/** Records each context's id, template and item. */
const recording =
  (seen: unknown[]): NodeExecutor =>
  context => {
    seen.push([context.id, context.template, context.item]);
    return echo(context);
  };

/** Items finish out of order: later ones first. */
const laterFirst: NodeExecutor = async context => {
  await tick(10 - (context.item?.index ?? 0) * 4);
  return echo(context);
};

/** Peak of how many run at once, each after a tick. */
const peaking = () => {
  let active = 0;
  let peak = 0;
  const executor: NodeExecutor = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await tick(3);
    active -= 1;
    return pass();
  };
  return { executor, peak: () => peak };
};

/** Fails the items named, passes the rest. */
const failing =
  (ids: readonly string[]): NodeExecutor =>
  context =>
    Promise.resolve(ids.includes(context.id) ? fail("broke") : pass());

/** Runs until its signal aborts, then returns what a stopped session would. */
const untilStopped = (context: ExecuteContext): Promise<NodeResult> =>
  new Promise(resolve => {
    context.signal.addEventListener("abort", () => {
      resolve(pass("cut"));
    });
  });

const worktree: Workspace = {
  prepare: () => Promise.resolve({ cwd: process.cwd() }),
  checkpoint: () => Promise.resolve(null),
  finish: (id, result) =>
    Promise.resolve({
      ...result,
      output: {
        ...result.output,
        branch: `ork/r1/${id}`,
        worktree: `/tmp/${id}`,
      },
    }),
  close: () => Promise.resolve([]),
};

/** A worker's full output: what `results` keeps some of. */
const reporting: NodeExecutor = context =>
  Promise.resolve({
    ok: true,
    output: {
      status: "pass",
      summary: `did ${context.id}`,
      files: 3,
      extra: "not gathered",
      usage: { costUsd: 1 },
    },
  });

/** A program's item: one passes with JSON, the other exits non-zero. */
const program: NodeExecutor = context =>
  Promise.resolve(
    context.item?.index === 0
      ? {
          ok: true,
          output: {
            exitCode: 0,
            stdout: "long",
            stderr: "",
            json: { score: 7 },
          },
        }
      : {
          ok: false,
          output: { exitCode: 1, stdout: "", stderr: "x" },
          error: "build.1 exited with code 1",
        },
  );

const parts = (source: string) => {
  const template = parseTemplate(source);
  if (!template.ok) throw new Error(template.message);
  return template.parts;
};

/** `next` keeps what the template renders to; the rest echo. */
const rendering = (out: { plain: string; readable: string }): NodeExecutor =>
  byId(
    {
      next: context => {
        const scope = runScope({}, context.outputs);
        const source = "{{nodes.build.output.results}}";
        out.plain = renderTemplate(parts(source), scope);
        out.readable = renderTemplate(parts(source), scope, { readable: true });
        return Promise.resolve(pass());
      },
    },
    echo,
  );

/** `build.0` asks to pause `build` while it runs. */
const pausingFirst =
  (ran: string[], paused: { handle?: RunHandle }): NodeExecutor =>
  context => {
    ran.push(context.id);
    if (context.id === "build.0") paused.handle?.pause("build");
    return Promise.resolve(pass());
  };

const noting =
  (ran: string[]): NodeExecutor =>
  context => {
    ran.push(context.id);
    return Promise.resolve(pass());
  };

/** A check that says go round once, and items that note their round. */
const looping = (rounds: string[]): NodeExecutor => {
  let checks = 0;
  return byId(
    {
      check: () => {
        checks += 1;
        return Promise.resolve({ ok: true, output: { again: checks === 1 } });
      },
    },
    context => {
      rounds.push(`${context.id}#${String(context.round)}`);
      return Promise.resolve(pass());
    },
  );
};

/** Records what the leader is offered. */
const offered = (seen: unknown[]): NodeExecutor =>
  byId(
    {
      lead: context => {
        seen.push(
          context.ownership?.children.map(child => child.id),
          context.ownership?.templates,
          context.ownership?.fanned,
        );
        return Promise.resolve(pass());
      },
    },
    echo,
  );

/** The leader claims `src` until the item has been refused; the item waits. */
const contending = () => {
  const refused = Promise.withResolvers<void>();
  const told = Promise.withResolvers<string>();
  const claims: unknown[] = [];
  const executor = byId({
    lead: async context => {
      context.claims?.claim("src");
      await refused.promise;
      context.claims?.release("src");
      return pass();
    },
    "build.0": async context => {
      const stop = context.mailbox?.connect(text => {
        told.resolve(text);
      });
      await tick();
      claims.push(context.claims?.claim("src/a.ts"));
      refused.resolve();
      await told.promise;
      claims.push(context.claims?.claim("src/a.ts"));
      stop?.();
      return pass();
    },
  });
  return { executor, told: told.promise, claims };
};

describe("what a fanned node runs over", () => {
  it("runs a static list, each item with its value and index", async () => {
    const seen: unknown[] = [];
    const { result, events } = await run(
      fanned("{ items: [api, web] }"),
      recording(seen),
    );
    expect(result.status).toBe("succeeded");
    expect(seen).toEqual([
      ["build.0", "build", { of: "build", index: 0, value: "api" }],
      ["build.1", "build", { of: "build", index: 1, value: "web" }],
    ]);
    expect(listed(events)).toEqual([
      {
        type: "each.listed",
        node: "build",
        round: 1,
        count: 2,
        list: ["api", "web"],
      },
    ]);
    expect(startedEventOf(events, "build.1")).toMatchObject({
      item: { of: "build", index: 1 },
    });
  });

  it("brackets the fan-out with the node's own started and finished", async () => {
    const { events } = await run(fanned("{ items: [a] }"), echo);
    expect(bracket(events)).toEqual([
      "node.started build",
      "node.started build.0",
      "node.finished build.0",
      "node.finished build",
    ]);
  });

  it("reads a list from an earlier node's output", async () => {
    const tasks = [{ title: "x" }, { title: "y" }];
    const { result, events } = await run(fromPlan(), planned(tasks));
    expect(result.status).toBe("succeeded");
    expect(started(events)).toEqual(["plan", "build", "build.0", "build.1"]);
    expect(finishedOf(events, "build").output["items"]).toEqual(tasks);
  });

  it("succeeds with count 0 on an empty list", async () => {
    const { result, events } = await run(fromPlan(), planned([]));
    expect(result.status).toBe("succeeded");
    expect(finishedOf(events, "build")).toMatchObject({
      ok: true,
      output: { items: [], results: [], statuses: [], count: 0 },
    });
  });

  it("fails the node on a value that isn't a list, in a field's words", async () => {
    const { events } = await run(fromPlan(), planned("fix it"));
    expect(finishedOf(events, "build")).toMatchObject({
      ok: false,
      error: "could not start: tasks is `fix it`, expected a list",
    });
    expect(hasStarted(events, "build.0")).toBe(false);
  });

  it("stops a list over maxItems when told to", async () => {
    const { events } = await run(fromPlan(), planned([1, 2, 3, 4]));
    expect(events).toContainEqual({
      type: "each.exceeded",
      node: "build",
      round: 1,
      count: 4,
      maxItems: 3,
    });
    expect(finishedOf(events, "build").ok).toBe(false);
    expect(hasStarted(events, "build.0")).toBe(false);
  });

  it.each([
    ["mcp.call", ["    server: s", "    tool: t"]],
    ["workflow.call", ["    workflow: w.ork.yaml"]],
  ])("fans %s out through its own executor", async (type, fields) => {
    const graph = compile([
      "nodes:",
      "  build:",
      `    type: ${type}`,
      ...fields,
      "    forEach: { items: [a, b] }",
    ]);
    const { events } = await run(graph, echo);
    expect(started(events)).toEqual(["build", "build.0", "build.1"]);
    expect(finishedOf(events, "build").ok).toBe(true);
  });
});

describe("gathering", () => {
  it("keeps list order however items finish", async () => {
    const { events } = await run(fanned("{ items: [a, b, c] }"), laterFirst);
    expect(finishedOf(events, "build").output["results"]).toEqual([
      { summary: "build.0=a" },
      { summary: "build.1=b" },
      { summary: "build.2=c" },
    ]);
  });

  it("keeps a worker's declared fields, summary, branch and worktree only", async () => {
    const graph = compile([
      "nodes:",
      "  build:",
      "    type: claude.worker",
      "    prompt: do it",
      "    forEach: { items: [a] }",
      "    output: { schema: { files: number } }",
    ]);
    const { events } = await run(graph, reporting, worktree);
    expect(finishedOf(events, "build").output).toEqual({
      items: ["a"],
      results: [
        {
          files: 3,
          summary: "did build.0",
          branch: "ork/r1/build.0",
          worktree: "/tmp/build.0",
        },
      ],
      statuses: ["pass"],
      count: 1,
    });
  });

  it("reads a program's declared fields from its json, and pass or fail from how it ended", async () => {
    const graph = fanned(
      "{ items: [a, b] }",
      [],
      ["    output: { format: json, schema: { score: number } }"],
    );
    const { events } = await run(graph, program);
    expect(finishedOf(events, "build").output).toEqual({
      items: ["a", "b"],
      results: [
        { score: 7 },
        { exitCode: 1, error: "build.1 exited with code 1" },
      ],
      statuses: ["pass", "fail"],
      count: 2,
    });
  });

  it("lets a later node read each item's branch, as text when readable", async () => {
    const graph = compile([
      "nodes:",
      "  build:",
      "    type: claude.worker",
      "    prompt: do it",
      "    forEach: { items: [a, b] }",
      "  next:",
      "    type: claude.worker",
      "    prompt: merge",
      "edges:",
      "  - build -> next",
    ]);
    const out = { plain: "", readable: "" };
    await run(graph, rendering(out), worktree);
    expect(out.plain).toContain("ork/r1/build.1");
    expect(out.readable).toContain("branch: ork/r1/build.1");
    expect(out.readable).not.toContain("{");
  });
});

describe("pacing", () => {
  it("runs at most maxParallel tools at once", async () => {
    const { executor, peak } = peaking();
    await run(fanned("{ items: [a, b, c, d, e], maxParallel: 2 }"), executor);
    expect(peak()).toBe(2);
  });

  it("defaults maxParallel to limits.concurrency for tools too", async () => {
    const { executor, peak } = peaking();
    const graph = fanned("{ items: [a, b, c, d] }", [
      "limits: { concurrency: 3 }",
    ]);
    await run(graph, executor);
    expect(peak()).toBe(3);
  });

  it("makes Claude items share the run's session slots", async () => {
    const { executor, peak } = peaking();
    const graph = workers("{ items: [a, b, c, d, e], maxParallel: 5 }", [
      "limits: { concurrency: 2 }",
    ]);
    await run(graph, executor);
    expect(peak()).toBe(2);
  });
});

describe("when an item fails", () => {
  it("runs every item by default, and the node fails afterwards", async () => {
    const { events } = await run(
      fanned("{ items: [a, b, c], maxParallel: 1 }"),
      failing(["build.0"]),
    );
    expect(finishedOf(events, "build")).toMatchObject({
      ok: false,
      output: { statuses: ["fail", "pass", "pass"] },
      error: "1 of 3 items failed; first, build.0: broke",
    });
  });

  it("starts no more on onFailure: stop, and marks the rest skipped", async () => {
    const { events } = await run(
      fanned("{ items: [a, b, c], maxParallel: 1, onFailure: stop }"),
      failing(["build.0"]),
    );
    expect(started(events)).toEqual(["build", "build.0"]);
    expect(finishedOf(events, "build")).toMatchObject({
      ok: false,
      output: {
        statuses: ["fail", "skipped", "skipped"],
        results: [{ summary: "broke" }, {}, {}],
      },
      error: "1 of 3 items failed; first, build.0: broke; 2 not started",
    });
  });

  it("lets a running item finish its turn on onFailure: stop", async () => {
    const { events } = await run(
      fanned("{ items: [a, b, c], maxParallel: 2, onFailure: stop }"),
      byId({
        "build.0": () => Promise.resolve(fail("broke")),
        "build.1": () => tick(5).then(() => pass()),
      }),
    );
    expect(started(events)).toEqual(["build", "build.0", "build.1"]);
    expect(finishedOf(events, "build").output["statuses"]).toEqual([
      "fail",
      "pass",
      "skipped",
    ]);
  });

  it("routes on the gathered fields and on ok", async () => {
    const graph = compile([
      "nodes:",
      "  build:",
      "    type: tool.shell",
      "    command: x",
      "    forEach: { items: [a, b] }",
      "  ok_path:",
      "    type: tool.shell",
      "    command: x",
      "  triage:",
      "    type: tool.shell",
      "    command: x",
      "edges:",
      "  - build -> ok_path",
      "  - { from: build, to: triage, when: \"count(statuses, 'fail') > 0\" }",
    ]);
    const { events } = await run(graph, failing(["build.1"]));
    expect(started(events)).toContain("triage");
    expect(started(events)).not.toContain("ok_path");
  });
});

describe("limits, stop, pause and loops", () => {
  it("starts no more once the budget is spent, and the run ends as it does today", async () => {
    const { result, events } = await run(
      workers("{ items: [a, b, c], maxParallel: 1 }", [
        "limits: { budgetUsd: 1 }",
      ]),
      () => Promise.resolve(pass("spent", 1)),
    );
    expect(result.status).toBe("budget_exhausted");
    expect(started(events)).toEqual(["build", "build.0"]);
    expect(finishedOf(events, "build").output["statuses"]).toEqual([
      "pass",
      "skipped",
      "skipped",
    ]);
  });

  it("fires no notify on a fan-out the budget cut off", async () => {
    const graph = compile([
      "limits: { budgetUsd: 1 }",
      "nodes:",
      "  build:",
      "    type: claude.worker",
      "    prompt: do it",
      "    forEach: { items: [a, b], maxParallel: 1 }",
      "    notify:",
      "      - { to: other, body: 'done' }",
      "  other:",
      "    type: claude.worker",
      "    prompt: x",
      "edges:",
      "  - build -> other",
    ]);
    const { events } = await run(graph, () =>
      Promise.resolve(pass("spent", 1)),
    );
    expect(sentBy(events)).toEqual([]);
  });

  it("stops the running items and the node on ork stop --node build", async () => {
    const { handle, events } = begin(
      fanned("{ items: [a, b, c], maxParallel: 2 }"),
      untilStopped,
    );
    await until(() => hasStarted(events, "build.1"));
    expect(handle.stopNode("build")).toBe(true);
    await handle.done;
    expect(finishedOf(events, "build")).toMatchObject({
      ok: false,
      end: { kind: "interrupted" },
      output: { statuses: ["fail", "fail", "skipped"], count: 3 },
    });
    expect(finishedOf(events, "build.0").end?.kind).toBe("interrupted");
    expect(hasStarted(events, "build.2")).toBe(false);
  });

  it("stops one item on --node build.1, and onFailure decides the rest", async () => {
    const { handle, events } = begin(
      fanned("{ items: [a, b], maxParallel: 2 }"),
      byId({ "build.1": untilStopped }, () => tick(5).then(() => pass())),
    );
    await until(() => hasStarted(events, "build.1"));
    expect(handle.stopNode("build.1")).toBe(true);
    await handle.done;
    expect(finishedOf(events, "build")).toMatchObject({
      ok: false,
      output: { statuses: ["pass", "fail"] },
    });
  });

  it("holds new items while the node is paused, and goes on", async () => {
    const paused: { handle?: RunHandle } = {};
    const ran: string[] = [];
    const { handle, events } = begin(
      fanned("{ items: [a, b, c], maxParallel: 1 }"),
      pausingFirst(ran, paused),
    );
    paused.handle = handle;
    await until(() => events.some(event => event.type === "node.held"));
    await tick(5);
    expect(ran).toEqual(["build.0"]);
    expect(events).toContainEqual({
      type: "node.held",
      id: "build.1",
      at: "start",
    });
    handle.proceed("build");
    const result = await handle.done;
    expect(ran).toEqual(["build.0", "build.1", "build.2"]);
    expect(result.status).toBe("succeeded");
  });

  it("does not keep a session slot through a pause", async () => {
    const graph = compile([
      "limits: { concurrency: 1 }",
      "nodes:",
      "  build:",
      "    type: claude.worker",
      "    prompt: do it",
      "    forEach: { items: [a] }",
      "  other:",
      "    type: claude.worker",
      "    prompt: other",
    ]);
    const ran: string[] = [];
    const { handle } = begin(graph, noting(ran));
    handle.pause("build");
    await until(() => ran.includes("other"));
    expect(ran).toEqual(["other"]);
    handle.proceed("build");
    expect((await handle.done).status).toBe("succeeded");
  });

  it("resolves the list again and reruns every item in a loop round", async () => {
    const graph = compile([
      "nodes:",
      "  build:",
      "    type: tool.shell",
      "    command: x",
      "    forEach: { items: [a, b], maxParallel: 1 }",
      "  check:",
      "    type: tool.shell",
      "    command: x",
      "edges:",
      "  - build -> check",
      "  - { from: check, to: build, when: output.again, maxRounds: 1 }",
    ]);
    const rounds: string[] = [];
    const { events } = await run(graph, looping(rounds));
    expect(rounds).toEqual([
      "build.0#1",
      "build.1#1",
      "build.0#2",
      "build.1#2",
    ]);
    expect(listed(events).map(event => event.round)).toEqual([1, 2]);
  });

  it("fires notify once for the node, reading what it gathered", async () => {
    const graph = compile([
      "nodes:",
      "  build:",
      "    type: tool.shell",
      "    command: x",
      "    forEach: { items: [a, b] }",
      "    notify:",
      "      - { to: lead, body: 'done {{output.count}}' }",
      "  lead:",
      "    type: claude.worker",
      "    prompt: x",
      "edges:",
      "  - build -> lead",
    ]);
    const { events } = await run(graph, echo);
    expect(sentBy(events)).toEqual([["build", "done 2"]]);
  });
});

describe("a leader and its fanned children", () => {
  it("leaves a fanned child out of delegate and spawn_worker", async () => {
    const seen: unknown[] = [];
    await run(withFannedChild(["    maxWorkers: 2"]), offered(seen));
    expect(seen).toEqual([["code"], ["code"], ["build"]]);
  });

  it("makes items contend with the leader's claims, and tells them on release", async () => {
    const { executor, told, claims } = contending();
    const { events } = await run(withFannedChild(), executor);
    expect(await told).toContain("src was released by lead");
    expect(claims).toMatchObject([{ ok: false }, { ok: true }]);
    expect(events).toContainEqual({
      type: "claim.refused",
      node: "build.0",
      resource: "src/a.ts",
      holder: "lead",
      held: "src",
    });
  });
});

describe("what the store keeps of a list", () => {
  it("masks each.listed as it masks node.finished output", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ork-fan-"));
    const store = openStore(path.join(dir, "ork.db"));
    store.begin({ id: "r1", workflow: "t", file: "/w", project: "/p" });
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123";
    store.append("r1", {
      type: "each.listed",
      node: "build",
      round: 1,
      count: 1,
      list: [{ token: secret }],
    });
    const stored = JSON.stringify(store.events("r1"));
    store.close();
    rmSync(dir, { recursive: true, force: true });
    expect(stored).not.toContain(secret);
  });
});
