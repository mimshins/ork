/**
 * @file Tests for RFC-005 in the engine: who a tool node may write to, the
 *   compile checks on channels and `notify:`, a rule's firing, and a message's
 *   `via`, through the bus and a resumed run.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  createBus,
  createReplay,
  type HumanChannel,
  mailboxInstructions,
  type NodeExecutor,
  MESSAGE_LIMIT,
  resumeState,
  type RunEvent,
  type RunHandle,
  startRun,
} from "../src/index.ts";
import {
  contactsOf,
  declaredNodes,
  scriptContactsOf,
} from "../src/run/contacts.ts";
import { mailOf } from "../src/run/mail.ts";
import { createRules, defaultRuleBody } from "../src/run/rules.ts";

const compile = (body: string) => {
  const parsed = parseWorkflow(`schemaVersion: 1\nname: t\n${body}`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return compileWorkflow(parsed.workflow);
};

const graphOf = (body: string) => {
  const { graph, diagnostics } = compile(body);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const codesOf = (body: string): string[] =>
  compile(body).diagnostics.map(d => d.code);

const human: HumanChannel = {
  ask: () => Promise.resolve(""),
  permit: () => Promise.resolve({ allow: true }),
};

const TEAM = graphOf(`nodes:
  lead: { type: claude.leader }
  check: { type: tool.shell, command: prog, parent: lead }
  builder: { type: claude.worker, parent: lead }
  ci: { type: tool.shell, command: prog }
  apart: { type: claude.worker }
messages:
  - between: [ci, apart]
`);

describe("who a tool node may write to", () => {
  const nodes = declaredNodes(TEAM);

  it("is its owner and its channels", () => {
    expect(scriptContactsOf("check", nodes, TEAM.channels)).toEqual(["lead"]);
    expect(scriptContactsOf("ci", nodes, TEAM.channels)).toEqual(["apart"]);
  });

  it("does not make it a contact of the session, which cannot reach it", () => {
    expect(contactsOf("apart", nodes, TEAM.channels).channels).toEqual([]);
    expect(contactsOf("lead", nodes, TEAM.channels).children).toEqual([
      "builder",
    ]);
    const bus = createBus({ graph: TEAM, onEvent: () => {} });
    expect(bus.mailbox("apart").peers()).toEqual([]);
    expect(bus.mailbox("lead").peers()).toEqual(["builder"]);
  });

  it("gives its recipient an inbox even with no one to write to", () => {
    const bus = createBus({ graph: TEAM, onEvent: () => {} });
    expect(bus.mailbox("apart").hears()).toBe(true);
    expect(bus.mailbox("lead").hears()).toBe(true);
    expect(bus.mailbox("builder").hears()).toBe(false);
  });
});

const ruled = (rule: string, more = "") =>
  codesOf(`nodes:
  w: { type: claude.worker }
  t:
    type: tool.shell
    command: prog
    notify:
      - ${rule}
${more}`);

const TOOL_NODE = "  o: { type: tool.shell, command: prog }\n";
const GATE_NODE = "  o: { type: human.gate, question: q, options: [a, b] }\n";

describe("the compile checks", () => {
  it("takes a tool node on a channel with a session", () => {
    expect(
      codesOf(`nodes:
  w: { type: claude.worker }
  t: { type: tool.shell, command: prog }
messages:
  - between: [t, w]
`),
    ).toEqual([]);
  });

  it.each([
    ["another tool node", "o: { type: tool.shell, command: prog }"],
    ["a call", "o: { type: workflow.call, workflow: x, node: y }"],
  ])("refuses a tool node on a channel with %s", (_name, other) => {
    expect(
      codesOf(`nodes:
  t: { type: tool.shell, command: prog }
  ${other}
messages:
  - between: [t, o]
`),
    ).toContain("message.endpoint");
  });

  it("takes a rule to a leader or worker", () => {
    expect(ruled("{ to: w }")).toEqual([]);
  });

  it.each([
    ["an unknown node", "nobody", "", "notify.target"],
    ["a tool node", "o", TOOL_NODE, "notify.target"],
    ["a gate", "o", GATE_NODE, "notify.target"],
    ["itself", "t", "", "notify.self"],
  ])("refuses a rule to %s", (_name, to, more, code) => {
    expect(ruled(`{ to: ${to} }`, more)).toContain(code);
  });

  it("checks a rule's condition and body as an edge's", () => {
    expect(ruled('{ to: w, when: "exitCode != 0" }')).toEqual([]);
    expect(ruled('{ to: w, when: "!ok" }')).toEqual([]);
    expect(ruled('{ to: w, when: "error != null" }')).toEqual([]);
    expect(ruled('{ to: w, when: "((" }')).toEqual(["notify.when-syntax"]);
    expect(ruled('{ to: w, when: "nothing == 1" }')).toEqual(["ref.field"]);
    expect(ruled('{ to: w, when: "env.X == 1" }')).toEqual(["template.env"]);
    expect(ruled('{ to: w, body: "{{" }')).toEqual(["template.syntax"]);
    expect(ruled('{ to: w, body: "{{env.X}}" }')).toEqual(["template.env"]);
    expect(ruled('{ to: w, body: "{{nodes.z.output.a}}" }')).toEqual([
      "ref.node",
    ]);
  });

  it.each([
    ["claude.subagent", "{ type: claude.subagent, parent: w, description: d }"],
    ["control.split", "{ type: control.split }"],
  ])("does not take a rule on a %s", (_name, node) => {
    const parsed = parseWorkflow(`schemaVersion: 1
name: t
nodes:
  w: { type: claude.leader }
  n: ${node.replace("}", ", notify: [{ to: w }] }")}
`);
    expect(parsed.ok).toBe(false);
  });
});

const FLOW = graphOf(`nodes:
  check:
    type: tool.shell
    command: prog
    notify:
      - { to: builder, when: "!ok", body: "failed: {{nodes.check.output.stderr}}" }
      - { to: builder }
      - { to: builder, when: "exitCode == 99", body: never }
  builder: { type: claude.worker }
edges:
  - { from: check, to: builder, when: "exitCode >= 0" }
`);

const runFlow = async (
  exitCode: number,
  replay?: ReturnType<typeof createReplay>,
) => {
  const events: RunEvent[] = [];
  const check: NodeExecutor = () =>
    Promise.resolve({
      ok: exitCode === 0,
      output: { exitCode, stdout: "", stderr: "boom\nlast line" },
      ...(exitCode === 0 ? {} : { error: "prog exited" }),
    });
  const seen: string[] = [];
  const builder: NodeExecutor = ({ mailbox }) => {
    seen.push(...(mailbox?.read().map(m => m.body) ?? []));
    return Promise.resolve({ ok: true, output: { status: "pass" } });
  };
  const result = await startRun({
    graph: FLOW,
    inputs: {},
    cwd: import.meta.dirname,
    executors: { "tool.shell": check, "claude.worker": builder },
    human,
    onEvent: event => {
      events.push(event);
    },
    ...(replay === undefined ? {} : { replay }),
  }).done;
  const sent = events.flatMap(e => (e.type === "message.sent" ? [e] : []));
  return { result, events, sent, seen };
};

describe("a rule firing", () => {
  it("sends what holds, before the edge starts its target", async () => {
    const { sent, seen, events } = await runFlow(3);
    expect(sent.map(m => [m.node, m.to, m.via, m.body])).toEqual([
      ["check", "builder", "rule", "failed: boom\nlast line"],
      ["check", "builder", "rule", "check exited 3: last line"],
    ]);
    expect(seen).toHaveLength(2);
    const types = events.map(e => e.type);
    expect(types.indexOf("message.sent")).toBeGreaterThan(
      types.indexOf("node.finished"),
    );
    expect(types.indexOf("message.sent")).toBeLessThan(
      types.indexOf("edge.taken"),
    );
  });

  it("uses Ork's own line with no body", async () => {
    const { sent } = await runFlow(0);
    expect(sent.map(m => m.body)).toEqual(["check exited 0"]);
  });

  it("does not fire again for a result a resumed run hands back", async () => {
    const first = await runFlow(0);
    const state = resumeState(first.events);
    const again = await runFlow(0, createReplay(state.history));
    expect(again.sent).toEqual([]);
  });

  it("starts no session, and waits unread for a node that never runs", async () => {
    const graph = graphOf(`nodes:
  check:
    type: tool.shell
    command: prog
    notify:
      - { to: later }
  later: { type: claude.worker }
  other: { type: tool.shell, command: prog }
edges:
  - { from: other, to: later, when: "exitCode == 1" }
`);
    const started: string[] = [];
    const events: RunEvent[] = [];
    await startRun({
      graph,
      inputs: {},
      cwd: import.meta.dirname,
      executors: {
        "tool.shell": () =>
          Promise.resolve({ ok: true, output: { exitCode: 0 } }),
        "claude.worker": ({ id }) => {
          started.push(id);
          return Promise.resolve({ ok: true, output: {} });
        },
      },
      human,
      onEvent: event => {
        events.push(event);
      },
    }).done;
    expect(started).toEqual([]);
    expect(mailOf(events).inboxes.get("later")).toMatchObject([
      { from: "check", via: "rule", body: "check exited 0" },
    ]);
  });

  it("names a spawned instance as the sender", () => {
    expect(
      defaultRuleBody("w-2", FLOW.nodes.get("builder")?.node, {
        ok: true,
        output: { summary: "all good" },
      }),
    ).toBe("w-2 passed: all good");
  });

  it("says why a node with a session failed", () => {
    const worker = FLOW.nodes.get("builder")?.node;
    expect(
      defaultRuleBody("w", worker, { ok: false, output: {}, error: "stopped" }),
    ).toBe("w failed: stopped");
    expect(defaultRuleBody("w", worker, { ok: false, output: {} })).toBe(
      "w failed",
    );
  });
});

/** A run whose only node waits to be stopped; `act` stops it. */
const cutOff = async (
  act: (handle: RunHandle) => void,
  result: Parameters<
    typeof Promise.resolve<Awaited<ReturnType<NodeExecutor>>>
  >[0],
) => {
  const events: RunEvent[] = [];
  const began = Promise.withResolvers<void>();
  const check: NodeExecutor = ({ signal }) => {
    began.resolve();
    const { promise, resolve } =
      Promise.withResolvers<Awaited<ReturnType<NodeExecutor>>>();
    signal.addEventListener("abort", () => {
      resolve(result);
    });
    return promise;
  };
  const handle = startRun({
    graph: graphOf(`nodes:
  check:
    type: tool.shell
    command: prog
    notify:
      - { to: later }
  later: { type: claude.worker }
  other: { type: tool.shell, command: prog }
edges:
  - { from: other, to: later, when: "exitCode == 99" }
`),
    inputs: {},
    cwd: import.meta.dirname,
    executors: {
      "tool.shell": context =>
        context.id === "check"
          ? check(context)
          : Promise.resolve({ ok: true, output: { exitCode: 0 } }),
    },
    human,
    onEvent: event => {
      events.push(event);
    },
  });
  await began.promise;
  act(handle);
  await handle.done;
  return events.flatMap(e => (e.type === "message.sent" ? [e.body] : []));
};

const KILLED = {
  ok: false,
  output: { exitCode: -1, stdout: "", stderr: "" },
  error: "killed",
};

describe("a rule and a stop", () => {
  it("sends nothing for a node the stopping run cut off", async () => {
    expect(
      await cutOff(handle => {
        handle.interrupt();
      }, KILLED),
    ).toEqual([]);
  });

  it("still reports a node that finished as the run stopped", async () => {
    expect(
      await cutOff(
        handle => {
          handle.interrupt();
        },
        { ok: true, output: { exitCode: 0 } },
      ),
    ).toEqual(["check exited 0"]);
  });

  it("reports a node stopped alone, as the run goes on", async () => {
    expect(
      await cutOff(handle => {
        handle.stopNode("check");
      }, KILLED),
    ).toEqual(["check failed: stopped by the user"]);
  });
});

const KINDS = graphOf(`nodes:
  t: { type: tool.shell, command: prog }
  g: { type: human.gate, question: q, options: [yes, no] }
  c: { type: workflow.call, workflow: other, wait: none }
  w: { type: claude.worker }
`);

describe("Ork's own line about a result", () => {
  it.each([
    [
      "a program that failed",
      "t",
      { ok: false, output: { exitCode: 3, stderr: "a\nb" }, error: "x" },
      "t exited 3: b",
    ],
    [
      "a program that passed",
      "t",
      { ok: true, output: { exitCode: 0 } },
      "t exited 0",
    ],
    [
      "a program stopped alone",
      "t",
      { ok: false, output: { status: "fail" }, error: "stopped by the user" },
      "t failed: stopped by the user",
    ],
    [
      "a result that is not valid JSON",
      "t",
      { ok: false, output: { exitCode: 0 }, error: "t: not valid JSON" },
      "t failed: not valid JSON",
    ],
    [
      "a program that timed out",
      "t",
      {
        ok: false,
        output: { exitCode: 143, timedOut: true },
        error: "timed out after 5s",
      },
      "t failed: timed out after 5s",
    ],
    [
      "a program that never started",
      "t",
      { ok: false, output: { exitCode: -1 }, error: "no such program" },
      "t failed: no such program",
    ],
    [
      "a gate's answer",
      "g",
      { ok: true, output: { choice: "no", answeredBy: "user" } },
      "g answered: no",
    ],
    [
      "a gate no one answered",
      "g",
      { ok: true, output: { choice: "no", answeredBy: "timeout" } },
      "g timed out and took its default: no",
    ],
    [
      "a call that did not wait",
      "c",
      { ok: true, output: { summary: "Run abc started." } },
      "c: Run abc started.",
    ],
    [
      "a session that failed",
      "w",
      { ok: false, output: { summary: "no" } },
      "w failed: no",
    ],
  ])("says what happened for %s", (_name, id, result, line) => {
    expect(defaultRuleBody(id, KINDS.nodes.get(id)?.node, result)).toBe(line);
  });
});

const fired = (
  bodies: string,
  activation: { id: string; template?: string },
  result: { ok: boolean; output: Record<string, unknown> },
  scrub?: (text: string) => string,
): string[] => {
  const graph = graphOf(`inputs:
  tok: { type: string, required: false }
nodes:
  lead: { type: claude.leader }
  w:
    type: claude.worker
    parent: lead
    notify:
      - to: lead
        body: ${JSON.stringify(bodies)}
`);
  const sent: string[] = [];
  const rules = createRules({
    graph,
    send: (_from, _to, body) => {
      sent.push(body);
    },
    scope: () => ({ inputs: { tok: "the-value-of-tok" }, nodes: {} }),
    stopping: new AbortController().signal,
    scrub,
  });
  rules.fire({ input: undefined, ...activation }, result);
  return sent;
};

const compiledBody = (body: string) =>
  compile(`nodes:
  w:
    type: claude.worker
    notify:
      - { to: x, body: ${JSON.stringify(body)} }
  x: { type: claude.worker }
`).diagnostics;

describe("a rule's body", () => {
  it("reads its own result, also from a spawned instance", () => {
    expect(
      fired(
        "{{ok}} {{output.summary}} {{summary}} {{nodes.w.output.summary}}",
        { id: "w-1", template: "w" },
        { ok: true, output: { summary: "done" } },
      ),
    ).toEqual(["true done done done"]);
  });

  it("is masked before it reaches the inbox", () => {
    const token = `ghp_${"a".repeat(30)}`;
    expect(
      fired(
        `{{inputs.tok}} ${token}`,
        { id: "w" },
        { ok: true, output: {} },
        text => text.replaceAll("the-value-of-tok", "[run mask]"),
      ),
    ).toEqual(["[run mask] [masked]"]);
  });

  it("is cut at the limit, as a rule cannot be refused", () => {
    const body = fired(
      "{{summary}}",
      { id: "w" },
      { ok: true, output: { summary: "é".repeat(MESSAGE_LIMIT) } },
    ).join();
    expect(Buffer.byteLength(body)).toBeLessThan(MESSAGE_LIMIT + 64);
    expect(body).toContain("(cut at 64 KiB)");
  });

  it("is told where a bad reference is", () => {
    expect(compiledBody("{{inputs.nope}}")[0]?.path).toEqual([
      "nodes",
      "w",
      "notify",
      0,
      "body",
    ]);
  });

  it("cannot read the user's variables", () => {
    expect(compiledBody("{{env.HOME}}").map(d => d.code)).toContain(
      "template.env",
    );
  });

  it("takes its own result with no diagnostic", () => {
    expect(compiledBody("{{ok}} {{error}} {{output.summary}}")).toEqual([]);
  });

  it("warns that ok and error mean how the node ended", () => {
    const { diagnostics } = compile(`nodes:
  w:
    type: claude.worker
    output: { schema: { ok: { type: boolean } } }
    notify:
      - { to: x, when: "ok" }
  x: { type: claude.worker }
`);
    expect(diagnostics.map(d => [d.severity, d.code])).toContainEqual([
      "warning",
      "notify.shadowed",
    ]);
    expect(diagnostics.map(d => d.message).join()).toContain(
      "nodes.w.output.ok",
    );
  });
});

describe("before a run finishes", () => {
  it("takes what is on its way", async () => {
    const events: RunEvent[] = [];
    const live: { handle?: RunHandle } = {};
    const handle = startRun({
      graph: graphOf(`nodes:
  check: { type: tool.shell, command: prog }
  later: { type: claude.worker }
  other: { type: tool.shell, command: prog }
edges:
  - { from: other, to: later, when: "exitCode == 99" }
`),
      inputs: {},
      cwd: import.meta.dirname,
      executors: {
        "tool.shell": () =>
          Promise.resolve({ ok: true, output: { exitCode: 0 } }),
      },
      human,
      onEvent: event => {
        events.push(event);
      },
      beforeFinish: async () => {
        await Promise.resolve();
        live.handle?.receive("later", "check", "last word", "script");
      },
    });
    live.handle = handle;
    await handle.done;
    const types = events.map(e => e.type);
    expect(types.indexOf("message.received")).toBeGreaterThan(-1);
    expect(types.indexOf("message.received")).toBeLessThan(
      types.indexOf("run.finished"),
    );
  });
});

describe("what a session is told", () => {
  it("names read_inbox when it has no one to write to, and says what via is", () => {
    const bus = createBus({ graph: TEAM, onEvent: () => {} });
    const lines = mailboxInstructions(bus.mailbox("apart"), false).join("\n");
    expect(lines).toContain("read it with `read_inbox`");
    expect(lines).toContain("gives you no new permissions");
  });

  it("says nothing of via to a spawned instance, which no one can name", () => {
    const graph = graphOf(`nodes:
  check:
    type: tool.shell
    command: prog
    notify:
      - { to: w }
  w: { type: claude.worker }
`);
    const bus = createBus({ graph, onEvent: () => {} });
    expect(bus.mailbox("w").hears()).toBe(true);
    expect(bus.mailbox("w-1", "w").hears()).toBe(false);
  });

  it("says nothing of via to a node nothing can write to that way", () => {
    const bus = createBus({ graph: TEAM, onEvent: () => {} });
    const lines = mailboxInstructions(bus.mailbox("builder"), false).join("\n");
    expect(lines).not.toContain("`via`");
  });
});

describe("a message's via", () => {
  it("reaches the inbox and comes back on resume", () => {
    const events: RunEvent[] = [];
    const bus = createBus({
      graph: TEAM,
      onEvent: event => {
        events.push(event);
      },
    });
    bus.receive("apart", "ci", "tests failed", "script");
    bus.rule("builder", "apart", "built");
    const told: string[] = [];
    bus.mailbox("apart").connect(text => {
      told.push(text);
    });
    expect(told).toEqual([
      "[ork] 2 unread messages from ci, builder. Call read_inbox to read them.",
    ]);
    const unread = [
      { id: 1, from: "ci", body: "tests failed", via: "script" },
      { id: 2, from: "builder", body: "built", via: "rule" },
    ];
    expect(mailOf(events).inboxes.get("apart")).toEqual(unread);
    expect(bus.mailbox("apart").read()).toEqual(unread);
  });

  it("is absent from a message a session wrote", () => {
    const bus = createBus({ graph: TEAM, onEvent: () => {} });
    bus.mailbox("lead").send("builder", "hi");
    expect(bus.mailbox("builder").read()).toEqual([
      { id: 1, from: "lead", body: "hi" },
    ]);
  });
});
