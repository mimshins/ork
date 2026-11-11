/**
 * @file Tests for links between runs and the relay (RFC-003): making and ending
 *   links, what a send may do, the limit, and two runs on separate store
 *   connections, as separate processes are, exchanging messages over their real
 *   sockets.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type CompiledGraph,
  compileWorkflow,
  createBus,
  createRelay,
  endLinksOf,
  type EventStore,
  type HumanChannel,
  linkNodes,
  type Mailbox,
  mailboxInstructions,
  type NodeExecutor,
  openStore,
  socketPath,
  type RunEvent,
  startControl,
  startRun,
  unlinkNodes,
} from "../src/index.ts";
import { mailOf } from "../src/run/mail.ts";

const ignore = (): void => {
  // These tests look at results, not at this.
};

const WORKERS: NonNullable<
  Extract<RunEvent, { type: "run.started" }>["nodes"]
> = [
  { id: "builder", type: "agent.worker" },
  { id: "script", type: "tool.shell" },
];

/** Records a running run with the nodes `ork tree` would draw. */
const begin = (
  store: EventStore,
  id: string,
  settings?: { links: "off" },
): void => {
  store.begin({
    id,
    workflow: "w",
    file: "w.ork.yaml",
    project: `/repo/${id}`,
  });
  store.append(id, {
    type: "run.started",
    runId: id,
    workflow: "w",
    entries: [],
    nodes: WORKERS,
    ...(settings === undefined ? {} : { settings }),
  });
};

const notices = (store: EventStore, run: string) =>
  store
    .takeCommands(run)
    .flatMap(command =>
      command.kind === "notice" ? [`${command.node}: ${command.body}`] : [],
    );

const answering = (choice: string): HumanChannel & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    permit: () => Promise.resolve({ allow: true }),
    ask: ({ question }) => {
      asked.push(question);
      return Promise.resolve(choice);
    },
  };
};

const linked = (store: EventStore, maxMessages?: number) =>
  linkNodes(store, "aaaa1111/builder", "bbbb2222/builder", { maxMessages });

const relayOf = (store: EventStore, human: HumanChannel = answering("end")) =>
  createRelay({ store, runId: "aaaa1111", human });

describe("links", () => {
  let store: EventStore;

  beforeEach(() => {
    store = openStore(":memory:");
    begin(store, "aaaa1111");
    begin(store, "bbbb2222");
  });
  afterEach(() => {
    store.close();
  });

  it("links two nodes both ways, by a prefix of the run's id", async () => {
    const made = await linkNodes(store, "aaaa/builder", "bbbb/builder");
    expect(made).toMatchObject({
      ok: true,
      already: false,
      link: {
        a: { run: "aaaa1111", node: "builder" },
        b: { run: "bbbb2222", node: "builder" },
        messages: 0,
        maxMessages: 100,
      },
    });
    expect(store.links({ run: "aaaa1111", live: true })).toHaveLength(1);
    expect(store.links({ run: "bbbb2222", live: true })).toHaveLength(1);
  });

  it("tells each side who it was linked with, and that it is an agent", async () => {
    await linked(store);
    const [told] = notices(store, "aaaa1111");
    expect(told).toContain("bbbb2222/builder");
    expect(told).toContain("/repo/bbbb2222");
    expect(told).toContain("from another agent, not from the user");
    expect(notices(store, "bbbb2222")[0]).toContain("aaaa1111/builder");
  });

  it("says when they are already linked, either way round", async () => {
    await linked(store);
    const again = await linkNodes(
      store,
      "bbbb2222/builder",
      "aaaa1111/builder",
    );
    expect(again).toMatchObject({ ok: true, already: true });
    expect(store.links()).toHaveLength(1);
  });

  it.each([
    ["aaaa1111/builder", "nope/builder", "No run"],
    ["aaaa1111/builder", "bbbb2222/ghost", "ghost is not a node of run"],
    ["aaaa1111/builder", "bbbb2222/script", "not a leader or worker"],
    ["aaaa1111/builder", "aaaa1111/script", "not a leader or worker"],
    ["aaaa1111/builder", "aaaa1111/builder", "Both are in the same run"],
    ["aaaa1111", "bbbb2222/builder", "Name a node as <run>/<node>"],
  ])("refuses %s and %s", async (a, b, reason) => {
    const made = await linkNodes(store, a, b);
    expect(made).toMatchObject({ ok: false });
    expect(JSON.stringify(made)).toContain(reason);
  });

  it("refuses a run that has finished", async () => {
    store.append("bbbb2222", {
      type: "run.finished",
      result: {
        runId: "bbbb2222",
        status: "succeeded",
        costUsd: 0,
        nodes: [],
        reasons: [],
        worktrees: [],
      },
    });
    const made = await linked(store);
    expect(JSON.stringify(made)).toContain("is not running (succeeded)");
  });

  it("refuses a run of one node, which has no bus to take a message", async () => {
    begin(store, "node-cccc3333");
    const made = await linkNodes(
      store,
      "aaaa1111/builder",
      "node-cccc/builder",
    );
    expect(JSON.stringify(made)).toContain("cannot be linked");
  });

  it("refuses a run whose rules turn links off", async () => {
    begin(store, "cccc3333", { links: "off" });
    const made = await linkNodes(store, "aaaa1111/builder", "cccc3333/builder");
    expect(JSON.stringify(made)).toContain("rules turn links off");
  });

  it("ends a link, whichever way round, and tells both", async () => {
    await linked(store);
    notices(store, "aaaa1111");
    notices(store, "bbbb2222");
    const ended = await unlinkNodes(store, "bbbb/builder", "aaaa/builder");
    expect(ended).toEqual({ ok: true });
    expect(store.links({ live: true })).toEqual([]);
    expect(notices(store, "aaaa1111")[0]).toContain("the user ended it");
    expect(notices(store, "bbbb2222")[0]).toContain(
      "Messages to it are refused",
    );
  });

  it("says when there is nothing to end", async () => {
    const ended = await unlinkNodes(store, "aaaa/builder", "bbbb/builder");
    expect(ended).toMatchObject({ ok: false });
  });

  it("ends a run's links when it finishes, and tells the other side", async () => {
    await linked(store);
    notices(store, "bbbb2222");
    await endLinksOf(store, "aaaa1111", "succeeded");
    expect(store.links({ live: true })).toEqual([]);
    expect(notices(store, "bbbb2222")[0]).toContain(
      "its run finished (succeeded)",
    );
  });
});

describe("the relay", () => {
  let store: EventStore;

  beforeEach(async () => {
    store = openStore(":memory:");
    begin(store, "aaaa1111");
    begin(store, "bbbb2222");
    await linked(store, 2);
    notices(store, "aaaa1111");
    notices(store, "bbbb2222");
  });
  afterEach(() => {
    store.close();
  });

  it("lists a node's links by address, and no one else's", () => {
    const relay = relayOf(store);
    expect(relay.peers("builder")).toEqual(["bbbb2222/builder"]);
    expect(relay.peers("script")).toEqual([]);
  });

  it("queues the message for the other run, with who sent it", () => {
    const sent = relayOf(store).send("builder", "bbbb2222/builder", "hello");
    expect(sent).toEqual({ ok: true, delivered: "queued" });
    expect(store.takeCommands("bbbb2222")).toEqual([
      {
        kind: "relay",
        node: "builder",
        from: "aaaa1111/builder",
        body: "hello",
      },
    ]);
    expect(store.links()[0]?.messages).toBe(1);
  });

  it("masks a secret in the message", () => {
    const secret = `ghp_${"a".repeat(36)}`;
    relayOf(store).send("builder", "bbbb2222/builder", `token ${secret}`);
    expect(JSON.stringify(store.takeCommands("bbbb2222"))).not.toContain(
      secret,
    );
  });

  it("refuses a node with no link to the address", () => {
    const sent = relayOf(store).send("script", "bbbb2222/builder", "hello");
    expect(sent).toEqual({
      ok: false,
      error: "you have no live link to bbbb2222/builder",
    });
    expect(store.takeCommands("bbbb2222")).toEqual([]);
  });

  it("refuses a finished run, says how to resume it, and ends the link", () => {
    store.append("bbbb2222", {
      type: "run.finished",
      result: {
        runId: "bbbb2222",
        status: "failed",
        costUsd: 0,
        nodes: [],
        reasons: [],
        worktrees: [],
      },
    });
    const sent = relayOf(store).send("builder", "bbbb2222/builder", "hello");
    expect(JSON.stringify(sent)).toContain("its run has finished (failed)");
    expect(JSON.stringify(sent)).toContain("ork chat");
    expect(store.links({ live: true })).toEqual([]);
    expect(
      store.takeCommands("bbbb2222").filter(c => c.kind === "relay"),
    ).toEqual([]);
  });

  it("asks the user at the limit and refuses until they answer", async () => {
    const human = answering("extend");
    const relay = relayOf(store, human);
    relay.send("builder", "bbbb2222/builder", "one");
    relay.send("builder", "bbbb2222/builder", "two");
    const third = relay.send("builder", "bbbb2222/builder", "three");
    expect(JSON.stringify(third)).toContain("all 2 of its messages");
    expect(human.asked).toHaveLength(1);
    expect(human.asked[0]).toContain("Let them go on?");
    await vi.waitFor(() => {
      expect(store.links()[0]?.maxMessages).toBe(4);
    });
    expect(relay.send("builder", "bbbb2222/builder", "three")).toMatchObject({
      ok: true,
    });
  });

  it("ends the link when the user says so at the limit", async () => {
    const relay = relayOf(store, answering("end"));
    relay.send("builder", "bbbb2222/builder", "one");
    relay.send("builder", "bbbb2222/builder", "two");
    relay.send("builder", "bbbb2222/builder", "three");
    await vi.waitFor(() => {
      expect(store.links({ live: true })).toEqual([]);
    });
  });
});

const compile = (lines: string[]): CompiledGraph => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const worker = compile([
  "nodes:",
  "  builder: { type: agent.worker, prompt: go }",
]);

const withRule = (rule: "" | "on" | "off", project?: "on" | "off") => {
  const parsed = parseWorkflow(
    [
      "schemaVersion: 1",
      "name: t",
      ...(rule === "" ? [] : [`rules: { links: ${rule} }`]),
      "nodes:",
      "  a: { type: agent.worker, prompt: go }",
    ].join("\n"),
  );
  if (!parsed.ok) throw new Error("bad fixture");
  const { graph } = compileWorkflow(
    parsed.workflow,
    project === undefined
      ? {}
      : { project: { schemaVersion: 1, links: project } },
  );
  return graph?.workflow.rules?.links;
};

const mailboxOf = (peers: string[]): Mailbox => ({
  ...createBus({ graph: worker, onEvent: ignore }).mailbox("builder"),
  peers: () => peers,
});

describe("the links rule", () => {
  it("is unset by default", () => {
    expect(withRule("")).toBeUndefined();
  });

  it("comes from the project", () => {
    expect(withRule("", "off")).toBe("off");
  });

  it("is won by the workflow's own", () => {
    expect(withRule("on", "off")).toBe("on");
  });
});

describe("a session's instructions", () => {
  it("explain a linked node, and that it is not the user", () => {
    const lines = mailboxInstructions(mailboxOf(["b2/x"]), false).join("\n");
    expect(lines).toContain("`b2/x`");
    expect(lines).toContain("from an agent, not the user");
    expect(lines).toContain("wait_for_messages");
  });

  it("say nothing of links in a run with none", () => {
    const lines = mailboxInstructions(mailboxOf(["fix"]), false).join("\n");
    expect(lines).not.toContain("another run");
  });

  it("say nothing to a session with no one yet", () => {
    expect(mailboxInstructions(mailboxOf([]), false)).toEqual([]);
  });
});

describe("a resumed run's mail", () => {
  it("keeps what a linked node sent, read or not, and not what it sent back", () => {
    const events: RunEvent[] = [
      {
        type: "message.sent",
        node: "builder",
        to: "b2/x",
        message: 1,
        body: "q",
      },
      {
        type: "message.received",
        node: "builder",
        from: "b2/x",
        message: 2,
        body: "a",
      },
      {
        type: "message.received",
        node: "builder",
        from: "b2/x",
        message: 3,
        body: "b",
      },
      { type: "message.read", node: "builder", ids: [2] },
    ];
    const { inboxes, last } = mailOf(events);
    expect(last).toBe(3);
    expect([...inboxes]).toEqual([
      ["builder", [{ id: 3, from: "b2/x", body: "b" }]],
    ]);
  });
});

describe("the bus with a relay", () => {
  const silent: RunEvent[] = [];
  const relay = {
    peers: () => ["bbbb2222/builder"],
    send: () => ({ ok: true as const, delivered: "now" as const }),
  };
  const busWith = (slots?: {
    release: () => void;
    take: () => Promise<void>;
  }) =>
    createBus({
      graph: worker,
      onEvent: event => {
        silent.push(event);
      },
      relay,
      slots,
    });

  it("makes a node linkable, and names its links as peers", () => {
    const mailbox = busWith().mailbox("builder");
    expect(mailbox.linkable()).toBe(true);
    expect(mailbox.peers()).toEqual(["bbbb2222/builder"]);
  });

  it("is not linkable with no relay", () => {
    const bus = createBus({ graph: worker, onEvent: ignore });
    expect(bus.mailbox("builder").linkable()).toBe(false);
  });

  it("records a message it relays", () => {
    const events: RunEvent[] = [];
    const bus = createBus({
      graph: worker,
      onEvent: event => {
        events.push(event);
      },
      relay,
    });
    bus.mailbox("builder").send("bbbb2222/builder", "hi");
    expect(events).toEqual([
      {
        type: "message.sent",
        node: "builder",
        to: "bbbb2222/builder",
        message: 1,
        body: "hi",
      },
    ]);
  });

  it("gives a message from another run as a notice, then a read", () => {
    const events: RunEvent[] = [];
    const bus = createBus({
      graph: worker,
      onEvent: event => {
        events.push(event);
      },
      relay,
    });
    const mailbox = bus.mailbox("builder");
    const told: string[] = [];
    mailbox.connect(text => {
      told.push(text);
    });
    bus.receive("builder", "bbbb2222/builder", "done");
    expect(told).toEqual([
      "[ork] 1 unread message from bbbb2222/builder. Call read_inbox to read them.",
    ]);
    expect(mailbox.read()).toEqual([
      { id: 1, from: "bbbb2222/builder", body: "done" },
    ]);
    expect(events.map(event => event.type)).toEqual([
      "message.received",
      "message.read",
    ]);
  });

  it("waits for a message, giving up the slot meanwhile", async () => {
    const slots = {
      release: vi.fn<() => void>(),
      take: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    };
    const bus = busWith(slots);
    const mailbox = bus.mailbox("builder");
    mailbox.connect(ignore);
    const waiting = mailbox.wait(60_000);
    expect(slots.release).toHaveBeenCalledOnce();
    bus.receive("builder", "bbbb2222/builder", "done");
    await waiting;
    expect(slots.take).toHaveBeenCalledOnce();
    expect(mailbox.pending()).toBe(1);
  });

  it("stops waiting after the time given", async () => {
    const bus = busWith();
    const mailbox = bus.mailbox("builder");
    mailbox.connect(ignore);
    await mailbox.wait(5);
    expect(mailbox.pending()).toBe(0);
  });

  it("does not wait when a message is already there", async () => {
    const slots = {
      release: vi.fn<() => void>(),
      take: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    };
    const bus = busWith(slots);
    const mailbox = bus.mailbox("builder");
    mailbox.connect(ignore);
    bus.receive("builder", "bbbb2222/builder", "done");
    await mailbox.wait(60_000);
    expect(slots.release).not.toHaveBeenCalled();
  });

  it("stops waiting when Ork has something to tell the session", async () => {
    const bus = busWith();
    const mailbox = bus.mailbox("builder");
    const told: string[] = [];
    mailbox.connect(text => {
      told.push(text);
    });
    const waiting = mailbox.wait(60_000);
    bus.notify("builder", "[ork] linked");
    await waiting;
    expect(told).toEqual(["[ork] linked"]);
  });

  it("stops waiting when the session ends", async () => {
    const bus = busWith();
    const mailbox = bus.mailbox("builder");
    const disconnect = mailbox.connect(ignore);
    const waiting = mailbox.wait(60_000);
    disconnect();
    await waiting;
    expect(mailbox.pending()).toBe(0);
  });
});

const TALK = /^(message\.|link\.notice)/u;

type Talk = (
  send: (body: string) => void,
  next: () => Promise<void>,
) => Promise<void>;

const OK = { ok: true, output: { status: "pass", summary: "ok" } };

/** Stands in for a session: starts once linked, then talks as `talk` says. */
const sessionOf =
  (linkedUp: Promise<void>, heard: string[]) =>
  (talk: Talk): NodeExecutor =>
  async ({ mailbox }) => {
    const box =
      mailbox ?? createBus({ graph: worker, onEvent: ignore }).mailbox("x");
    const disconnect = box.connect(ignore);
    await linkedUp;
    await talk(
      body => {
        const [peer = ""] = box.peers();
        expect(box.send(peer, body)).toMatchObject({ ok: true });
      },
      async () => {
        await vi.waitFor(
          () => {
            expect(box.pending()).toBeGreaterThan(0);
          },
          { timeout: 3000 },
        );
        for (const { from, body } of box.read()) heard.push(`${from}: ${body}`);
      },
    );
    disconnect();
    return OK;
  };

describe("two runs, each with its own store connection and socket", () => {
  let home: string;
  let file: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "ork-links-"));
    file = path.join(home, "state.db");
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  /** One run as its own process has it: store, control, relay, scheduler. */
  const startSide = async (id: string, executor: NodeExecutor) => {
    const store = openStore(file);
    store.begin({ id, workflow: "t", file: "t", project: `/repo/${id}` });
    const started = Promise.withResolvers<ReturnType<typeof startRun>>();
    const whenStarted = (act: (run: ReturnType<typeof startRun>) => void) => {
      void started.promise.then(act);
    };
    const record = (event: RunEvent) => {
      control.publish(store.append(id, event));
    };
    const control = await startControl({
      store,
      runId: id,
      home,
      emit: record,
      onStop: ignore,
      onMessage: ignore,
      onRelay: (node, from, body) => {
        whenStarted(run => {
          run.receive(node, from, body);
        });
      },
      onNotice: (node, text) => {
        whenStarted(run => {
          run.notice(node, text);
        });
      },
    });
    const run = startRun({
      graph: worker,
      inputs: {},
      cwd: home,
      executors: { "agent.worker": executor },
      human: control.human,
      onEvent: record,
      runId: id,
      runDir: path.join(home, id),
      relay: createRelay({ store, runId: id, home, human: control.human }),
    });
    started.resolve(run);
    return {
      store,
      done: async () => {
        const result = await run.done;
        await endLinksOf(store, id, result.status, home);
        await control.close();
        store.close();
        return result;
      },
    };
  };

  it("carries messages both ways, and each run records its side", async () => {
    // Longer than this, the runs have no sockets and only their polls are tested.
    expect(socketPath("aaaa1111", home).length).toBeLessThan(104);
    const heard: string[] = [];
    const connected = Promise.withResolvers<void>();
    const session = sessionOf(connected.promise, heard);
    const asker = await startSide(
      "aaaa1111",
      session(async (send, next) => {
        send("what is the API shape?");
        await next();
      }),
    );
    const answerer = await startSide(
      "bbbb2222",
      session(async (send, next) => {
        await next();
        send("{ id: string }");
      }),
    );
    await vi.waitFor(() => {
      expect(asker.store.events("aaaa1111").length).toBeGreaterThan(0);
      expect(answerer.store.events("bbbb2222").length).toBeGreaterThan(0);
    });
    const linkStore = openStore(file);
    const made = await linkNodes(linkStore, "aaaa/builder", "bbbb/builder", {
      home,
    });
    expect(made).toMatchObject({ ok: true });
    connected.resolve();
    const results = await Promise.all([asker.done(), answerer.done()]);
    expect(results.map(result => result.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(heard.toSorted()).toEqual([
      "aaaa1111/builder: what is the API shape?",
      "bbbb2222/builder: { id: string }",
    ]);
    const types = linkStore
      .events("bbbb2222")
      .map(stored => stored.event.type)
      .filter(type => TALK.test(type));
    expect(types).toEqual([
      "link.notice",
      "message.received",
      "message.read",
      "message.sent",
    ]);
    expect(linkStore.links({ live: true })).toEqual([]);
    expect(linkStore.links()[0]?.messages).toBe(2);
    linkStore.close();
  }, 15_000);
});
