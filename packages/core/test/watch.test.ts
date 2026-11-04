/**
 * @file Tests for `watch:` (RFC-011): looking until a condition holds, what a
 *   failed look and an undeclared answer do, the wait's own timeout, control,
 *   what's recorded, and that waiting isn't work.
 */

import { setTimeout as sleep } from "node:timers/promises";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it, vi } from "vitest";

import {
  type CompiledGraph,
  compileWorkflow,
  type NodeExecutor,
  type NodeResult,
  type RunEvent,
  type RunHandle,
  startRun,
} from "../src/index.ts";
import { runTree } from "../src/store/view.ts";

const HEADER = ["schemaVersion: 1", "name: t", "nodes:"];

const compiledOf = (lines: readonly string[]) => {
  const parsed = parseWorkflow([...HEADER, ...lines].join("\n"));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return compileWorkflow(parsed.workflow);
};

const graphOf = (lines: readonly string[]): CompiledGraph => {
  const { graph, diagnostics } = compiledOf(lines);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

/** The floor on `every` puts a timeout out of a test's reach, so it's set here. */
const timingOutIn = (timeout: string, graph: CompiledGraph): CompiledGraph => {
  const node = graph.nodes.get("ci")?.node;
  if (node === undefined || !("watch" in node) || node.watch === undefined) {
    throw new Error("no watch");
  }
  node.watch.timeout = timeout;
  return graph;
};

const codesOf = (lines: readonly string[]): string[] =>
  compiledOf(lines).diagnostics.map(({ code }) => code);

const watching = (until: string, more = ""): string[] => [
  "  ci:",
  "    type: tool.shell",
  "    command: x",
  "    output:",
  "      format: json",
  "      schema: { result: [pending, passed, failed] }",
  `    watch: { every: 5s, until: "${until}", timeout: 6s${more} }`,
];

const said = (result: string, extra = {}): NodeResult => ({
  ok: true,
  output: { exitCode: 0, stdout: "", stderr: "", json: { result }, ...extra },
});

const lost: NodeResult = {
  ok: false,
  transient: true,
  output: { exitCode: 1, stdout: "", stderr: "offline" },
  error: "x exited with 1: offline",
};

/** Answers in order, then keeps giving the last. */
const scripted = (
  answers: readonly NodeResult[],
): NodeExecutor & { calls: () => number } => {
  let calls = 0;
  const executor = () => {
    const answer = answers[Math.min(calls, answers.length - 1)];
    calls += 1;
    if (answer === undefined) throw new Error("no answers");
    return Promise.resolve(answer);
  };
  return Object.assign(executor, { calls: () => calls });
};

const started = (
  graph: CompiledGraph,
  executor: NodeExecutor,
  everyMs = 1,
): { handle: RunHandle; events: RunEvent[] } => {
  const events: RunEvent[] = [];
  const handle = startRun({
    graph,
    inputs: {},
    cwd: "/nowhere",
    runDir: "/nowhere/run",
    executors: { "tool.shell": executor },
    human: {
      permit: () => Promise.resolve({ allow: true }),
      ask: () => Promise.resolve("ok"),
    },
    onEvent: event => {
      events.push(event);
    },
    watchEveryMs: everyMs,
    timeoutGraceMs: 10,
  });
  return { handle, events };
};

const ofType = <T extends RunEvent["type"]>(
  events: readonly RunEvent[],
  type: T,
): Extract<RunEvent, { type: T }>[] =>
  events.filter(
    (event): event is Extract<RunEvent, { type: T }> => event.type === type,
  );

/** Never ends, even when told to. */
const stuck: NodeExecutor = () =>
  new Promise(() => {
    // Never settles.
  });

/** Works until it's told to stop. */
const busy: NodeExecutor = context =>
  new Promise(resolve => {
    context.signal.addEventListener("abort", () => {
      resolve({ ok: false, output: {} });
    });
  });

const parses = (watch: string): boolean =>
  parseWorkflow(
    [
      ...HEADER,
      "  ci:",
      "    type: tool.shell",
      "    command: x",
      `    watch: ${watch}`,
    ].join("\n"),
  ).ok;

/** Keeps saying `pending` on `ci`; any other node is `busy`. */
const pendingOrBusy = (): Partial<Record<string, NodeExecutor>> => ({
  ci: () => Promise.resolve(said("pending")),
});

const byNode =
  (executors: Partial<Record<string, NodeExecutor>>): NodeExecutor =>
  context =>
    (executors[context.id] ?? busy)(context);

/** Says `tool.called` as a real look does, then answers as `answers` say. */
const calling = (answers: NodeExecutor): NodeExecutor => {
  return context => {
    context.emit({ type: "tool.called", id: "ci", name: "x", input: {} });
    return answers(context);
  };
};

/** Passes once `other` has run, which it can't if this holds the only slot. */
const waitsForOther: NodeExecutor = context =>
  Promise.resolve(
    said(context.outputs["other"] === undefined ? "pending" : "passed"),
  );

/** Says `pending` until it's told it may pass, as a source that's slow does. */
const passingWhenTold = (): { executor: NodeExecutor; tell: () => void } => {
  let ready = false;
  return {
    executor: () => Promise.resolve(said(ready ? "passed" : "pending")),
    tell: () => {
      ready = true;
    },
  };
};

describe("a watch", () => {
  it("looks until the condition holds, and the last look is its output", async () => {
    const executor = scripted([
      said("pending"),
      said("pending"),
      said("passed"),
    ]);
    const { handle } = started(
      graphOf(watching("json.result != 'pending'")),
      executor,
    );
    const result = await handle.done;
    expect(result.status).toBe("succeeded");
    expect(executor.calls()).toBe(3);
    expect(result.nodes[0]?.output).toMatchObject({
      json: { result: "passed" },
    });
    expect(result.nodes[0]?.runs).toBe(1);
  });

  it("records what changed and how it ended, not every look", async () => {
    const executor = scripted([
      said("pending"),
      said("pending"),
      said("pending"),
      said("failed"),
    ]);
    const { handle, events } = started(
      graphOf(watching("json.result != 'pending'")),
      executor,
    );
    await handle.done;
    expect(ofType(events, "watch.changed").map(event => event.looks)).toEqual([
      1, 4,
    ]);
    expect(ofType(events, "watch.ended")).toEqual([
      { type: "watch.ended", id: "ci", looks: 4, outcome: "met" },
    ]);
  });

  it("compares only what's declared, so a timestamp isn't a change", async () => {
    const stamped = (at: number): NodeResult =>
      said("pending", { json: { result: "pending", at } });
    const executor = scripted([stamped(1), stamped(2), said("passed")]);
    const { handle, events } = started(
      graphOf(watching("json.result != 'pending'")),
      executor,
    );
    await handle.done;
    expect(ofType(events, "watch.changed")).toHaveLength(2);
  });

  it("records a look's call once", async () => {
    const both = calling(scripted([said("pending"), said("passed")]));
    const { handle, events } = started(
      graphOf(watching("json.result != 'pending'")),
      both,
    );
    await handle.done;
    expect(
      ofType(events, "node.event").filter(
        ({ event }) => event.type === "tool.called",
      ),
    ).toHaveLength(1);
  });

  it("looks again after a failed look, and a good look resets the count", async () => {
    const executor = scripted([
      lost,
      lost,
      said("pending"),
      lost,
      lost,
      said("passed"),
    ]);
    const { handle } = started(
      graphOf(watching("json.result != 'pending'")),
      executor,
    );
    expect((await handle.done).status).toBe("succeeded");
    expect(executor.calls()).toBe(6);
  });

  it("ends after `misses` failed looks in a row", async () => {
    const executor = scripted([lost]);
    const { handle } = started(
      graphOf(watching("json.result != 'pending'", ", misses: 2")),
      executor,
    );
    const result = await handle.done;
    expect(executor.calls()).toBe(2);
    expect(result.status).toBe("failed");
    expect(result.nodes[0]?.error).toContain("2 looks in a row failed");
  });

  it("fails at once on an answer it didn't declare", async () => {
    const executor = scripted([
      { ok: false, output: {}, error: "result is maybe, expected pending" },
    ]);
    const { handle, events } = started(
      graphOf(watching("json.result != 'pending'")),
      executor,
    );
    const result = await handle.done;
    expect(executor.calls()).toBe(1);
    expect(result.nodes[0]?.error).toContain("result is maybe");
    expect(ofType(events, "watch.ended")[0]?.outcome).toBe("failed");
  });

  it("fails at its timeout, keeping the last look, and an edge can catch it", async () => {
    const executor = scripted([said("pending")]);
    const graph = graphOf([
      ...watching("json.result != 'pending'"),
      "  fix: { type: tool.shell, command: y }",
      "edges:",
      '  - { from: ci, to: fix, when: "!ok" }',
    ]);
    const { handle, events } = started(timingOutIn("1s", graph), executor, 5);
    const result = await handle.done;
    const ci = result.nodes.find(({ id }) => id === "ci");
    expect(ci?.ok).toBe(false);
    expect(ci?.error).toContain("never held");
    expect(ci?.output).toMatchObject({
      timedOut: true,
      json: { result: "pending" },
    });
    expect(result.nodes.map(({ id }) => id)).toContain("fix");
    expect(ofType(events, "watch.ended")[0]?.outcome).toBe("timed_out");
  });

  it("isn't held up by a look that won't end at its timeout", async () => {
    const { handle } = started(
      timingOutIn("1s", graphOf(watching("json.result != 'pending'"))),
      stuck,
    );
    const result = await handle.done;
    expect(result.nodes[0]?.error).toContain("never held");
  });

  it("stops when the user stops it", async () => {
    const executor = scripted([said("pending")]);
    const { handle, events } = started(
      graphOf(watching("json.result != 'pending'")),
      executor,
      5,
    );
    await sleep(30);
    handle.stopNode("ci");
    const result = await handle.done;
    expect(result.nodes[0]?.error).toBe("stopped by the user");
    expect(ofType(events, "watch.ended")[0]?.outcome).toBe("stopped");
  });

  it("looks no more while paused, and goes on after", async () => {
    const executor = scripted([said("pending")]);
    const { handle, events } = started(
      graphOf([
        "  ci:",
        "    type: tool.shell",
        "    command: x",
        "    output:",
        "      format: json",
        "      schema: { result: [pending, passed, failed] }",
        `    watch: { every: 5s, until: "json.result != 'pending'", timeout: 1m }`,
      ]),
      executor,
      2,
    );
    await sleep(20);
    handle.pause();
    await sleep(10);
    const paused = executor.calls();
    await sleep(30);
    expect(executor.calls()).toBe(paused);
    expect(ofType(events, "node.held")).toHaveLength(1);
    handle.proceed();
    await sleep(30);
    expect(executor.calls()).toBeGreaterThan(paused);
    handle.interrupt();
    await handle.done;
  });

  it("doesn't run out of its timeout while paused, and goes on waiting after", async () => {
    const { executor, tell } = passingWhenTold();
    const { handle, events } = started(
      timingOutIn("1s", graphOf(watching("json.result != 'pending'"))),
      executor,
      5,
    );
    await sleep(50);
    handle.pause();
    // Well past the timeout, which would end the wait if its clock ran on.
    await sleep(1300);
    expect(ofType(events, "watch.ended")).toEqual([]);
    tell();
    handle.proceed();
    const result = await handle.done;
    expect(result.status).toBe("succeeded");
    expect(ofType(events, "watch.ended")[0]?.outcome).toBe("met");
  });

  it("still has what's left of its timeout after a pause", async () => {
    const { handle, events } = started(
      timingOutIn("1s", graphOf(watching("json.result != 'pending'"))),
      scripted([said("pending")]),
      5,
    );
    await sleep(50);
    handle.pause();
    await sleep(1100);
    handle.proceed();
    const result = await handle.done;
    expect(result.nodes[0]?.error).toContain("never held");
    expect(ofType(events, "watch.ended")[0]?.outcome).toBe("timed_out");
  });

  it("doesn't count the time between looks against limits.timeout", async () => {
    const executor = scripted([
      said("pending"),
      said("pending"),
      said("passed"),
    ]);
    const graph = graphOf([
      "  ci:",
      "    type: tool.shell",
      "    command: x",
      "    output:",
      "      format: json",
      "      schema: { result: [pending, passed, failed] }",
      `    watch: { every: 5s, until: "json.result != 'pending'", timeout: 1m }`,
      "limits: { timeout: 1s }",
    ]);
    // Longer between looks than the whole run may work.
    const { handle } = started(graph, executor, 700);
    expect((await handle.done).status).toBe("succeeded");
  });

  it("still counts other work against limits.timeout", async () => {
    const graph = graphOf([
      "  ci:",
      "    type: tool.shell",
      "    command: x",
      "    output:",
      "      format: json",
      "      schema: { result: [pending, passed, failed] }",
      `    watch: { every: 5s, until: "json.result != 'pending'", timeout: 1m }`,
      "  busy: { type: tool.shell, command: y }",
      "limits: { timeout: 1s }",
    ]);
    const executor = byNode(pendingOrBusy());
    const { handle } = started(graph, executor, 5);
    expect((await handle.done).status).toBe("timed_out");
  });

  it("shows what it's waiting for only while it waits", async () => {
    const executor = scripted([said("pending"), said("passed")]);
    const graph = graphOf(watching("json.result != 'pending'"));
    const { handle, events } = started(graph, executor);
    await handle.done;
    const last = events.findIndex(event => event.type === "node.finished");
    const during = runTree(events.slice(0, last))[0]?.watching;
    expect(during).toMatchObject({
      until: "json.result != 'pending'",
      every: "5s",
      looks: 2,
      ok: true,
    });
    expect(runTree(events)[0]?.watching).toBeUndefined();
  });
});

describe("a watch and the session slots", () => {
  it("holds none, so work goes on beside it at concurrency 1", async () => {
    const graph = graphOf([
      ...watching("json.result != 'pending'"),
      "  other: { type: claude.worker, prompt: go }",
      "limits: { concurrency: 1 }",
    ]);
    const handle = startRun({
      graph,
      inputs: {},
      cwd: "/nowhere",
      runDir: "/nowhere/run",
      executors: {
        "tool.shell": waitsForOther,
        "claude.worker": () => Promise.resolve({ ok: true, output: {} }),
      },
      human: {
        permit: () => Promise.resolve({ allow: true }),
        ask: () => Promise.resolve("ok"),
      },
      onEvent: () => {
        // Not what this is about.
      },
      watchEveryMs: 2,
    });
    // It passes only once `other` has run, which needs the only slot.
    expect((await handle.done).status).toBe("succeeded");
  });
});

const printed = (stdout: string): NodeResult => ({
  ok: true,
  output: { exitCode: 0, stdout, stderr: "" },
});

/** Stays until `ci` has said it passed. */
const leadsUntilCiPasses: NodeExecutor = async context => {
  await vi.waitFor(() => {
    expect(context.outputs["ci"]).toBeDefined();
  }, 5000);
  return { ok: true, output: {} };
};

/** Says it's pending for this long, looking often enough to rest in between. */
const pendingFor = (ms: number): NodeExecutor => {
  const until = Date.now() + ms;
  return () => Promise.resolve(said(Date.now() < until ? "pending" : "passed"));
};

describe("an owner's clock", () => {
  it("stands still while a node it owns is between looks", async () => {
    const graph = graphOf([
      "  begin: { type: control.split }",
      "  lead: { type: claude.leader, prompt: go, timeout: 1s }",
      "  ci:",
      "    type: tool.shell",
      "    parent: lead",
      "    command: x",
      "    output:",
      "      format: json",
      "      schema: { result: [pending, passed, failed] }",
      `    watch: { every: 5s, until: "json.result != 'pending'", timeout: 1m }`,
      "edges:",
      "  - { from: begin, to: lead }",
      "  - { from: begin, to: ci }",
    ]);
    const handle = startRun({
      graph,
      inputs: {},
      cwd: "/nowhere",
      runDir: "/nowhere/run",
      executors: {
        "tool.shell": pendingFor(1500),
        "claude.leader": leadsUntilCiPasses,
      },
      human: {
        permit: () => Promise.resolve({ allow: true }),
        ask: () => Promise.resolve("ok"),
      },
      onEvent: () => {
        // Not what this is about.
      },
      watchEveryMs: 50,
      timeoutGraceMs: 10,
    });
    expect((await handle.done).status).toBe("succeeded");
  });
});

describe("a watch with no output: declared", () => {
  const bare = [
    "  ci:",
    "    type: tool.shell",
    "    command: x",
    `    watch: { every: 5s, until: "stdout == 'done'", timeout: 6s }`,
  ];

  it("still waits, rather than taking one look and moving on", async () => {
    const executor = scripted([printed("not yet"), printed("done")]);
    const { handle, events } = started(graphOf(bare), executor);
    expect((await handle.done).status).toBe("succeeded");
    expect(executor.calls()).toBe(2);
    expect(events.map(({ type }) => type)).toContain("watch.ended");
  });
});

describe("checking a watch", () => {
  it("accepts a condition on what's declared", () => {
    expect(codesOf(watching("json.result != 'pending'"))).toEqual([]);
    expect(codesOf(watching("json.result == 'passed'"))).toEqual([]);
  });

  it("refuses a value it never says, which would wait for nothing", () => {
    expect(codesOf(watching("json.result == 'pased'"))).toEqual([
      "watch.value",
    ]);
  });

  it("refuses waiting for it to fail", () => {
    expect(codesOf(watching("!ok"))).toEqual(["watch.until"]);
  });

  it("refuses a condition it can't read", () => {
    expect(codesOf(watching("json.result =="))).toEqual(["watch.until"]);
  });

  it("refuses a field the node doesn't declare, which it would wait for in vain", () => {
    expect(codesOf(watching("json.state == 'x'"))).toContain("watch.field");
  });

  it.each(["exitCode == 1", "!ok || exitCode == 9", "false"])(
    "refuses %s: a tested look can't say that",
    until => {
      expect(codesOf(watching(until))).toEqual(["watch.until"]);
    },
  );

  it("takes waiting for a look to succeed at all", () => {
    expect(codesOf(watching("exitCode == 0"))).toEqual([]);
  });

  it("knows an MCP call has no exit code", () => {
    expect(
      codesOf([
        "  ci:",
        "    type: mcp.call",
        "    server: s",
        "    tool: t",
        `    watch: { every: 5s, until: "exitCode == 0", timeout: 6s }`,
      ]),
    ).toContain("watch.until");
  });
});

describe("the format of a watch", () => {
  it("requires every field that bounds it", () => {
    expect(parses('{ every: 30s, until: "ok", timeout: 1h }')).toBe(true);
    expect(parses('{ until: "ok", timeout: 1h }')).toBe(false);
    expect(parses("{ every: 30s, timeout: 1h }")).toBe(false);
    expect(parses('{ every: 30s, until: "ok" }')).toBe(false);
  });

  it("has a floor on how often it looks", () => {
    expect(parses('{ every: 5s, until: "ok", timeout: 1h }')).toBe(true);
    expect(parses('{ every: 4s, until: "ok", timeout: 1h }')).toBe(false);
  });

  it("can't be longer than a timer can hold, which would fire at once", () => {
    expect(parses('{ every: 5s, until: "ok", timeout: 596h }')).toBe(true);
    expect(parses('{ every: 5s, until: "ok", timeout: 600h }')).toBe(false);
  });

  it("must have time for more than one look", () => {
    expect(parses('{ every: 1m, until: "ok", timeout: 1m }')).toBe(false);
  });
});
