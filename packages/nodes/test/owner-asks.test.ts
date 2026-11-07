/**
 * @file Tests for a child's question to its leader first (ADR-063) on stand-in
 *   runtimes: a leader with no session yet, a run with nothing left to spend, a
 *   runtime that fails, a fork that gives no valid choice and one that runs out
 *   of time all send it to the person; a node stopped while its leader thinks
 *   asks no one, and one stopped while the person is asked withdraws the
 *   question; a pause holds a fork back from starting; the pass-on option never
 *   takes a child's own option id; and a fork can only read, pays no hour-long
 *   cache write, and marks every event it records as a fork's.
 */

import type {
  ClaudeRuntime,
  ExecuteContext,
  HoldPort,
  HumanChannel,
  HumanQuestion,
  OwnerPort,
  RuntimeEvent,
  SessionOutcome,
  SessionSpec,
} from "@krapht/ork-core";
import { parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  FORK_TOOLS,
  ownerFirst,
  passedOnContext,
  passOnId,
} from "../src/index.ts";

const WORKFLOW = [
  "schemaVersion: 1",
  "name: owned",
  "nodes:",
  "  lead: { type: claude.leader, prompt: Plan, isolation: shared, questions: owner }",
  "  work: { type: claude.worker, parent: lead, prompt: Build, isolation: shared }",
].join("\n");

const workflowOf = (): Workflow => {
  const parsed = parseWorkflow(WORKFLOW);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

/** A person who picks the first option, and what they were asked. */
const person = () => {
  const asked: HumanQuestion[] = [];
  const human: HumanChannel = {
    ask: question => {
      asked.push(question);
      return Promise.resolve(question.options[0]?.id ?? "");
    },
    permit: () => Promise.resolve({ allow: true }),
  };
  return { human, asked };
};

/** A person who never answers, and what they were asked. */
const silentPerson = () => {
  const asked: HumanQuestion[] = [];
  const human: HumanChannel = {
    ask: question => {
      asked.push(question);
      return new Promise(() => {});
    },
    permit: () => Promise.resolve({ allow: true }),
  };
  return { human, asked };
};

const contextOf = (
  human: HumanChannel,
  signal: AbortSignal = new AbortController().signal,
  hold?: HoldPort,
): ExecuteContext => {
  const workflow = workflowOf();
  return {
    runId: "r1",
    id: "work",
    node: workflow.nodes["work"] ?? { type: "claude.worker", prompt: "x" },
    workflow,
    inputs: {},
    outputs: {},
    input: undefined,
    round: 1,
    cwd: "/w",
    runDir: "/w/.ork/runs/r1",
    workflowDir: "/w",
    projectRoot: "/w",
    budgetLeftUsd: undefined,
    human,
    emit: () => {},
    signal,
    ...(hold === undefined ? {} : { hold }),
  };
};

/** The leader's port, with or without a session to fork, and what it saw. */
const ownerPort = (sessionId?: string, budgetLeft = 5) => {
  const emitted: RuntimeEvent[] = [];
  const charged: string[] = [];
  const port: OwnerPort = {
    id: "lead",
    session: () =>
      sessionId === undefined
        ? undefined
        : { sessionId, cwd: "/w", driver: "cli" },
    budgetLeftUsd: () => budgetLeft,
    charge: forkSession => {
      charged.push(forkSession);
    },
    emit: event => {
      emitted.push(event);
    },
  };
  return { port, emitted, charged };
};

const outcomeOf = (
  fields: Record<string, unknown> | null,
  subtype = "success",
): SessionOutcome => ({
  subtype,
  sessionId: "fork-1",
  report:
    fields === null
      ? null
      : { status: "done", summary: "ok", artifacts: {}, fields },
  text: "",
  usage: {
    costUsd: 0.001,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turns: 1,
    durationMs: 1,
  },
  errors: [],
});

/** A fork's session: it reads a file, then reports `fields`, or none. */
const sessionEnding = async function* (
  fields: Record<string, unknown> | null,
): AsyncGenerator<RuntimeEvent> {
  await Promise.resolve();
  yield { type: "session.started", sessionId: "fork-1", model: "opus" };
  yield { type: "assistant.text", text: "Let me look at the spec." };
  yield { type: "tool.called", id: "t1", name: "Read", input: {} };
  yield { type: "tool.result", id: "t1", isError: false };
  yield { type: "session.finished", outcome: outcomeOf(fields) };
};

/** A runtime whose sessions end with `report`, and the specs it started. */
const forking = (fields: Record<string, unknown> | null) => {
  const specs: SessionSpec[] = [];
  const runtime: ClaudeRuntime = {
    driver: "cli",
    start: spec => {
      specs.push(spec);
      return {
        events: sessionEnding(fields),
        send: () => {},
        interrupt: () => Promise.resolve(),
      };
    },
  };
  return { runtime, specs };
};

/**
 * A runtime whose session works until it is interrupted, then ends cut off; it
 * says when the session started.
 */
const endless = () => {
  let interrupts = 0;
  const { promise: started, resolve: start } = Promise.withResolvers<void>();
  const runtime: ClaudeRuntime = {
    driver: "cli",
    start: () => {
      const { promise: cut, resolve } = Promise.withResolvers<void>();
      const events = async function* (): AsyncGenerator<RuntimeEvent> {
        yield { type: "session.started", sessionId: "fork-1", model: "opus" };
        start();
        await cut;
        yield {
          type: "session.finished",
          outcome: outcomeOf({ choice: "b" }),
        };
      };
      return {
        events: events(),
        send: () => {},
        interrupt: () => {
          interrupts += 1;
          resolve();
          return Promise.resolve();
        },
      };
    },
  };
  return { runtime, started, interrupts: () => interrupts };
};

/** A hold port held until `release`, and whether a wait began. */
const heldPort = () => {
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  let waited = false;
  const hold: HoldPort = {
    held: () => true,
    wait: () => {
      waited = true;
      return released;
    },
    watch: () => () => {},
  };
  return { hold, release, waited: () => waited };
};

const QUESTION = {
  nodeId: "work",
  question: "Which approach?",
  options: [{ id: "a" }, { id: "b" }],
};

const nodesOf = (asked: readonly HumanQuestion[]) => asked.map(q => q.nodeId);

describe("a child's question to its owner", () => {
  it("goes to the person, with no fork, while the leader has no session", async () => {
    const { human, asked } = person();
    let started = 0;
    const channel = ownerFirst(contextOf(human), ownerPort().port, {
      runtimeFor: () => {
        started += 1;
        return Promise.reject(new Error("no runtime here"));
      },
      inPlace: true,
    });

    expect(await channel.ask(QUESTION)).toBe("a");
    expect(nodesOf(asked)).toEqual(["work"]);
    expect(started).toBe(0);
  });

  it("goes to the person, with no fork, when the run has nothing left to spend", async () => {
    const { human, asked } = person();
    const { runtime, specs } = forking({ choice: "b" });
    const channel = ownerFirst(contextOf(human), ownerPort("lead-1", 0).port, {
      runtimeFor: () => Promise.resolve(runtime),
      inPlace: true,
    });

    expect(await channel.ask(QUESTION)).toBe("a");
    expect(nodesOf(asked)).toEqual(["work"]);
    expect(specs).toEqual([]);
  });

  it("goes to the person when the runtime fails", async () => {
    const { human, asked } = person();
    const channel = ownerFirst(contextOf(human), ownerPort("lead-1").port, {
      runtimeFor: () => Promise.reject(new Error("no driver")),
      inPlace: true,
    });

    expect(await channel.ask(QUESTION)).toBe("a");
    expect(nodesOf(asked)).toEqual(["work"]);
  });

  it("goes to the person when the fork's choice isn't an option", async () => {
    const { human, asked } = person();
    const { runtime } = forking({ choice: "c", note: "?" });
    const channel = ownerFirst(contextOf(human), ownerPort("lead-1").port, {
      runtimeFor: () => Promise.resolve(runtime),
      inPlace: true,
    });

    expect(await channel.ask(QUESTION)).toBe("a");
    expect(nodesOf(asked)).toEqual(["work"]);
  });

  it("goes to the person when the fork runs out of time", async () => {
    const { human, asked } = person();
    const { runtime, interrupts } = endless();
    const channel = ownerFirst(contextOf(human), ownerPort("lead-1").port, {
      runtimeFor: () => Promise.resolve(runtime),
      inPlace: true,
      timeoutMs: 5,
    });

    expect(await channel.ask(QUESTION)).toBe("a");
    expect(interrupts()).toBe(1);
    expect(nodesOf(asked)).toEqual(["work"]);
  });

  it("asks no one when the node stops while its leader is asked", async () => {
    const { human, asked } = person();
    const { runtime, started, interrupts } = endless();
    const stop = new AbortController();
    const { port, charged } = ownerPort("lead-1");
    const channel = ownerFirst(contextOf(human, stop.signal), port, {
      runtimeFor: () => Promise.resolve(runtime),
      inPlace: true,
    });

    const answer = channel.ask(QUESTION);
    await started;
    stop.abort();

    await expect(answer).rejects.toThrow("work was stopped");
    expect(interrupts()).toBe(1);
    expect(asked).toEqual([]);
    // What the fork spent before it was cut off still counts.
    expect(charged).toEqual(["fork-1"]);
  });

  it("withdraws the question from the person when the node stops", async () => {
    const { human, asked } = silentPerson();
    const stop = new AbortController();
    const { runtime } = forking({ choice: "ask-user", note: "Yours." });
    const channel = ownerFirst(
      contextOf(human, stop.signal),
      ownerPort("lead-1").port,
      { runtimeFor: () => Promise.resolve(runtime), inPlace: true },
    );

    void channel.ask(QUESTION);
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]?.signal?.aborted).toBe(false);
    stop.abort();
    expect(asked[0]?.signal?.aborted).toBe(true);
  });

  it("starts no fork while the node is held", async () => {
    const { human } = person();
    const { runtime, specs } = forking({ choice: "b" });
    const { hold, release, waited } = heldPort();
    const signal = new AbortController().signal;
    const channel = ownerFirst(
      contextOf(human, signal, hold),
      ownerPort("lead-1").port,
      { runtimeFor: () => Promise.resolve(runtime), inPlace: true },
    );

    const answer = channel.ask(QUESTION);
    await expect.poll(waited).toBe(true);
    expect(specs).toEqual([]);
    release();

    expect(await answer).toBe("b");
    expect(specs).toHaveLength(1);
  });

  it("forks the leader's session read-only, and takes its answer", async () => {
    const { human, asked } = person();
    const { runtime, specs } = forking({ choice: "b", note: "As planned." });
    const { port, emitted, charged } = ownerPort("lead-1");
    const channel = ownerFirst(contextOf(human), port, {
      runtimeFor: () => Promise.resolve(runtime),
      inPlace: true,
    });

    expect(await channel.ask(QUESTION)).toBe("b");
    expect(asked).toEqual([]);
    expect(specs[0]).toMatchObject({
      nodeId: "lead",
      resume: "lead-1",
      fork: true,
      maxTurns: 3,
      tools: { only: [...FORK_TOOLS], strictMcp: true },
    });
    expect(specs[0]?.tools.only).not.toContain("Bash");
    expect(specs[0]?.tools.only).not.toContain("Agent");
    expect(specs[0]?.tools.deny).toContain("mcp__ork__ask_user");
    expect(specs[0]?.agents).toBeUndefined();
    // Its prefix can't be the leader's: no hour-long cache write.
    expect(specs[0]?.promptCache).toBeUndefined();
    // Every event it recorded under the leader is marked as a fork's.
    expect(emitted.map(event => [event.type, event.fork])).toEqual([
      ["session.started", true],
      ["assistant.text", true],
      ["tool.called", true],
      ["tool.result", true],
      ["session.finished", true],
    ]);
    expect(charged).toEqual(["fork-1"]);
  });

  it("names its pass-on option so it never takes a child's", () => {
    expect(passOnId([{ id: "a" }])).toBe("ask-user");
    expect(passOnId([{ id: "ask-user" }, { id: "ask-user-2" }])).toBe(
      "ask-user-3",
    );
  });

  it("shows the person the leader's note under the child's context", () => {
    expect(passedOnContext("Two ways.", "lead", "Not mine to say.")).toBe(
      "Two ways.\n\nlead passed this on: Not mine to say.",
    );
    expect(passedOnContext(undefined, "lead")).toBe("lead passed this on.");
  });
});
