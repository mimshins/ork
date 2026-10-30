/**
 * @file Tests for the run's message bus: who may write to whom (the ownership
 *   tree, declared channels, spawned instances), notices into live sessions,
 *   reading the inbox, and questions to a live owner, alone and when a loop
 *   runs out of rounds.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  createBus,
  type CompiledGraph,
  type HumanChannel,
  inboxNotice,
  type NodeExecutor,
  type RunEvent,
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

/** A leader owning two workers, a worker on a channel, and a stranger. */
const TEAM = compile([
  "nodes:",
  "  lead: { type: claude.leader, prompt: lead, maxWorkers: 2 }",
  "  security: { type: claude.worker, parent: lead, prompt: s }",
  "  code: { type: claude.worker, parent: lead, prompt: c }",
  "  docs: { type: claude.worker, prompt: d }",
  "  other: { type: claude.worker, prompt: o }",
  "messages:",
  "  - between: [code, docs]",
]);

const QUESTION = {
  question: "Again?",
  options: [{ id: "stop" }, { id: "again" }],
  recommended: "stop",
};

const setup = (graph: CompiledGraph = TEAM) => {
  const events: RunEvent[] = [];
  const bus = createBus({
    graph,
    onEvent: event => {
      events.push(event);
    },
  });
  /** Connects `id`'s session; what it is told lands in the returned list. */
  const session = (id: string, template?: string) => {
    const told: string[] = [];
    const mailbox = bus.mailbox(id, template);
    const disconnect = mailbox.connect(text => {
      told.push(text);
    });
    return { mailbox, told, disconnect };
  };
  return { bus, events, session };
};

describe("addressing", () => {
  it("lets a node write to its owner, its children and its channels", () => {
    const { bus } = setup();
    expect(bus.mailbox("lead").peers()).toEqual(["security", "code"]);
    expect(bus.mailbox("code").peers()).toEqual(["lead", "docs"]);
    expect(bus.mailbox("docs").peers()).toEqual(["code"]);
    expect(bus.mailbox("other").peers()).toEqual([]);
  });

  it("refuses anyone else, and says whom it can reach", () => {
    const { bus, events } = setup();
    expect(bus.mailbox("security").send("docs", "hi")).toEqual({
      ok: false,
      error:
        '"docs" is not one of your contacts; you can message lead (your owner, the nodes you own, and your declared channels)',
    });
    expect(bus.mailbox("other").send("lead", "hi")).toEqual({
      ok: false,
      error: "you have no one to message in this run",
    });
    expect(events).toEqual([]);
  });

  it("gives a spawned instance its template's owner and channels, both ways", () => {
    const { bus } = setup();
    expect(bus.mailbox("code-2", "code").peers()).toEqual(["lead", "docs"]);
    expect(bus.mailbox("lead").peers()).toEqual(["security", "code", "code-2"]);
    expect(bus.mailbox("docs").send("code-2", "hi")).toMatchObject({
      ok: true,
    });
  });
});

describe("delivery", () => {
  it("puts a notice into a live session; the body waits in the inbox", () => {
    const { bus, events, session } = setup();
    const code = session("code");
    expect(bus.mailbox("docs").send("code", "API renamed")).toEqual({
      ok: true,
      delivered: "now",
    });
    expect(code.told).toEqual([
      "[ork] 1 unread message from docs. Call read_inbox to read them.",
    ]);
    expect(code.mailbox.read()).toEqual([
      { id: 1, from: "docs", body: "API renamed" },
    ]);
    expect(code.mailbox.read()).toEqual([]);
    expect(events).toEqual([
      {
        type: "message.sent",
        node: "docs",
        to: "code",
        message: 1,
        body: "API renamed",
      },
      { type: "message.read", node: "code", ids: [1] },
    ]);
  });

  it("queues messages for a node that is not running and tells it on start", () => {
    const { bus, session } = setup();
    expect(bus.mailbox("lead").send("code", "one")).toEqual({
      ok: true,
      delivered: "queued",
    });
    bus.mailbox("docs").send("code", "two");
    const code = session("code");
    expect(code.told).toEqual([
      "[ork] 2 unread messages from lead, docs. Call read_inbox to read them.",
    ]);
    expect(code.mailbox.read().map(m => m.body)).toEqual(["one", "two"]);
  });

  it("stops telling a session once it disconnects", () => {
    const { bus, session } = setup();
    const code = session("code");
    code.disconnect();
    expect(bus.mailbox("docs").send("code", "late")).toMatchObject({
      delivered: "queued",
    });
    expect(code.told).toEqual([]);
    expect(inboxNotice(code.mailbox.read())).toContain("1 unread message");
  });
});

describe("the user's messages", () => {
  it("go in full into a live session, or wait for the node's next one", () => {
    const { bus, events, session } = setup();
    const lead = session("lead");
    expect(bus.tell("lead", "skip the docs")).toBe("now");
    expect(lead.told).toEqual([
      "[ork] The user writes to you (ork chat):\nskip the docs",
    ]);
    expect(bus.tell("code", "use tabs")).toBe("queued");
    bus.mailbox("docs").send("code", "hi");
    expect(session("code").told).toEqual([
      "[ork] The user writes to you (ork chat):\nuse tabs",
      "[ork] 1 unread message from docs. Call read_inbox to read them.",
    ]);
    expect(events.filter(e => e.type === "user.message")).toEqual([
      {
        type: "user.message",
        node: "lead",
        body: "skip the docs",
        delivered: "now",
      },
      {
        type: "user.message",
        node: "code",
        body: "use tabs",
        delivered: "queued",
      },
    ]);
  });

  it("are refused for a node with no session", () => {
    const graph = compile([
      "nodes:",
      "  build: { type: tool.shell, command: make }",
    ]);
    expect(setup(graph).bus.tell("build", "hi")).toBeNull();
  });
});

describe("questions to a live owner", () => {
  it("asks the owner, refuses a wrong answer and takes a right one", async () => {
    const { bus, events, session } = setup();
    const lead = session("lead");
    const answer = bus.askOwner("code", QUESTION);
    expect(lead.told[0]).toContain(
      "[ork] Question q1 for you, as the owner of code: Again?",
    );
    expect(lead.mailbox.answer("q1", "maybe")).toEqual({
      ok: false,
      error: '"maybe" is not an option: stop, again',
    });
    expect(bus.mailbox("code").answer("q1", "again")).toMatchObject({
      ok: false,
    });
    expect(lead.mailbox.answer("q1", "again")).toEqual({ ok: true });
    expect(await answer).toBe("again");
    expect(events.map(e => e.type)).toEqual(["owner.asked", "owner.answered"]);
  });

  it("gives up when there is no live owner, or its session ends first", async () => {
    const { bus, events, session } = setup();
    expect(await bus.askOwner("docs", QUESTION)).toBeNull();
    expect(await bus.askOwner("code", QUESTION)).toBeNull();
    const lead = session("lead");
    const answer = bus.askOwner("code", QUESTION);
    lead.disconnect();
    expect(await answer).toBeNull();
    expect(events.at(-1)).toEqual({
      type: "owner.unanswered",
      node: "lead",
      question: "q1",
    });
  });
});

/** A leader that stays live until Ork asks it something, then answers `onward`. */
const answeringLead: NodeExecutor = ({ mailbox }) =>
  new Promise(resolve => {
    const disconnect = mailbox?.connect(text => {
      const id = /Question (q\d+)/u.exec(text)?.[1] ?? "";
      mailbox?.answer(id, "onward");
      disconnect?.();
      resolve({ ok: true, output: { status: "done", summary: "ok" } });
    });
  });

const work: NodeExecutor = () =>
  Promise.resolve({ ok: true, output: { status: "pass", exitCode: 0 } });

describe("a loop out of rounds in a run", () => {
  const graph = compile([
    "nodes:",
    "  lead: { type: claude.leader, prompt: lead }",
    "  start: { type: tool.shell, command: echo go }",
    "  fix: { type: claude.worker, parent: lead, prompt: fix }",
    "  check: { type: tool.shell, command: echo check }",
    "edges:",
    "  - { from: start, to: fix }",
    "  - { from: fix, to: check }",
    "  - { from: check, to: fix, when: 'exitCode == 0', maxRounds: 1 }",
  ]);

  it("asks the live leader that owns the loop, not the human", async () => {
    const asked: string[] = [];
    const human: HumanChannel = {
      ask: ({ question }) => {
        asked.push(question);
        return Promise.resolve("stop");
      },
      permit: () => Promise.resolve({ allow: true }),
    };
    const events: RunEvent[] = [];
    const { done } = startRun({
      graph,
      inputs: {},
      cwd: import.meta.dirname,
      executors: {
        "claude.leader": answeringLead,
        "claude.worker": work,
        "tool.shell": work,
      },
      human,
      onEvent: event => {
        events.push(event);
      },
    });
    expect((await done).status).toBe("succeeded");
    expect(asked).toEqual([]);
    expect(events.filter(e => e.type.startsWith("owner."))).toMatchObject([
      { type: "owner.asked", node: "lead", about: "fix", question: "q1" },
      { type: "owner.answered", node: "lead", answer: "onward" },
    ]);
  });
});
