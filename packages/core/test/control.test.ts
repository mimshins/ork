/**
 * @file Tests for a live run's control: decisions answered by the terminal or
 *   by another process (first wins), withdrawn questions, permissions, `stop`
 *   commands, and the run's socket (wake-ups and followers).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type EventStore,
  followSocket,
  type HumanChannel,
  openStore,
  type RunControl,
  type RunEvent,
  socketPath,
  startControl,
  type StoredEvent,
  wakeRun,
} from "../src/index.ts";

const QUESTION = {
  nodeId: "gate",
  question: "Merge?",
  options: [{ id: "merge" }, { id: "reject" }],
  recommended: "reject",
};

/** A store with run `r1`, a control for it, and what it emitted. */
const setup = async (local?: HumanChannel) => {
  const store: EventStore = openStore(":memory:");
  store.begin({ id: "r1", workflow: "w", file: "/w", project: "/p" });
  const home = mkdtempSync(path.join(tmpdir(), "ork-ctl-"));
  const events: RunEvent[] = [];
  let stops = 0;
  const control: RunControl = await startControl({
    store,
    runId: "r1",
    home,
    intervalMs: 60_000,
    emit: event => {
      events.push(event);
    },
    onStop: () => {
      stops += 1;
    },
    ...(local === undefined ? {} : { local }),
  });
  return { store, home, events, control, stops: () => stops };
};

/** A terminal that answers `answer` once its turn comes, or waits forever. */
const terminal = (answer?: string) => {
  const withdrawn: string[] = [];
  const human: HumanChannel = {
    ask: ({ signal, question }) =>
      new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => {
          withdrawn.push(question);
          reject(new Error("withdrawn"));
        });
        if (answer !== undefined) resolve(answer);
      }),
    permit: () => Promise.resolve({ allow: false, message: "not here" }),
  };
  return { human, withdrawn };
};

describe("the decision queue", () => {
  it("records a question and takes the terminal's answer", async () => {
    const { store, events, control } = await setup(terminal("merge").human);
    expect(await control.human.ask(QUESTION)).toBe("merge");
    expect(store.decision("r1-1")).toMatchObject({
      status: "answered",
      answer: "merge",
      answeredBy: "terminal",
    });
    expect(events.map(e => e.type)).toEqual([
      "decision.opened",
      "decision.answered",
    ]);
    await control.close();
  });

  it("takes an answer from another process first, withdrawing the terminal's prompt", async () => {
    const local = terminal();
    const { store, home, events, control } = await setup(local.human);
    const answer = control.human.ask(QUESTION);
    expect(store.answerDecision("r1-1", "reject", "decide")).toBe(true);
    expect(await wakeRun(socketPath("r1", home))).toBe(true);
    expect(await answer).toBe("reject");
    expect(local.withdrawn).toEqual(["Merge?"]);
    expect(events.at(-1)).toMatchObject({
      type: "decision.answered",
      by: "decide",
    });
    // A second answer loses.
    expect(store.answerDecision("r1-1", "merge", "decide")).toBe(false);
    await control.close();
  });

  it("closes a withdrawn question unanswered", async () => {
    const { store, events, control } = await setup();
    const withdraw = new AbortController();
    const answer = control.human.ask({ ...QUESTION, signal: withdraw.signal });
    withdraw.abort();
    await expect(answer).rejects.toThrow("withdrawn");
    expect(store.decision("r1-1")?.status).toBe("withdrawn");
    expect(events.at(-1)?.type).toBe("decision.withdrawn");
    await control.close();
  });

  it("turns a permission prompt into an allow-or-deny decision", async () => {
    const { store, control } = await setup();
    const permit = control.human.permit({
      nodeId: "fix",
      toolName: "Bash",
      input: { command: "rm -rf build" },
    });
    expect(store.decision("r1-1")).toMatchObject({
      kind: "permission",
      question: "Allow Bash?",
      context: '{"command":"rm -rf build"}',
    });
    store.answerDecision("r1-1", "deny", "decide");
    control.check();
    expect(await permit).toMatchObject({ allow: false });
    await control.close();
  });
});

describe("commands and the socket", () => {
  it("stops the run once when `ork stop` writes a command", async () => {
    const { store, events, control, stops } = await setup();
    store.command("r1", "stop");
    store.command("r1", "stop");
    control.check();
    expect(stops()).toBe(1);
    expect(events).toEqual([{ type: "run.command", command: "stop" }]);
    expect(store.takeCommands("r1")).toEqual([]);
    await control.close();
  });

  it("streams the backlog and new events to a follower, and ends with the run", async () => {
    const { store, home, control } = await setup();
    const started: RunEvent = {
      type: "node.started",
      id: "a",
      nodeType: "claude.worker",
      round: 1,
    };
    store.append("r1", started);
    const got: StoredEvent[] = [];
    const following = followSocket(socketPath("r1", home), 0, stored => {
      got.push(stored);
    });
    await expect.poll(() => got.length).toBe(1);
    control.publish(store.append("r1", { type: "node.skipped", id: "b" }));
    await expect.poll(() => got.length).toBe(2);
    await control.close();
    expect(await following).toBe("ended");
    expect(got.map(g => g.seq)).toEqual([1, 2]);
    expect(await wakeRun(socketPath("r1", home))).toBe(false);
  });

  it("says when no run is listening", async () => {
    const file = path.join(
      mkdtempSync(path.join(tmpdir(), "ork-ctl-")),
      "x.sock",
    );
    const none: StoredEvent[] = [];
    expect(
      await followSocket(file, 0, stored => {
        none.push(stored);
      }),
    ).toBe("unavailable");
  });
});
