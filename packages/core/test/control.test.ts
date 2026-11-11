/**
 * @file Tests for a live run's control: decisions answered by the terminal or
 *   by another process (first wins), withdrawn questions, permissions, `stop`
 *   commands, and the run's socket (wake-ups and followers).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
import { migrate, MIGRATIONS } from "../src/store/schema.ts";

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
  const messages: string[] = [];
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
    onMessage: (node, body) => {
      messages.push(`${node}: ${body}`);
    },
    ...(local === undefined ? {} : { local }),
  });
  return { store, home, events, control, messages, stops: () => stops };
};

/**
 * A terminal that answers `answer` once its turn comes, or waits forever; with
 * `note`, it says that too.
 */
const terminal = (answer?: string, note?: string) => {
  const withdrawn: string[] = [];
  const human: HumanChannel = {
    ask: ({ signal, question, onNote }) =>
      new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => {
          withdrawn.push(question);
          reject(new Error("withdrawn"));
        });
        if (note !== undefined) onNote?.(note);
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

  it("hands another process's note to the asker, masked, and puts it in the event", async () => {
    const { store, home, events, control } = await setup(terminal().human);
    const notes: string[] = [];
    const answer = control.human.ask({
      ...QUESTION,
      onNote: note => {
        notes.push(note);
      },
    });
    const secret = `sk-ant-${"x".repeat(24)}`;
    expect(
      store.answerDecision("r1-1", "reject", "ui", ` Use ${secret} \n`),
    ).toBe(true);
    await wakeRun(socketPath("r1", home));
    expect(await answer).toBe("reject");
    expect(notes).toEqual(["Use [masked]"]);
    expect(store.decision("r1-1")?.note).toBe("Use [masked]");
    expect(events.at(-1)).toEqual({
      type: "decision.answered",
      node: "gate",
      decision: "r1-1",
      answer: "reject",
      by: "ui",
      note: "Use [masked]",
    });
    await control.close();
  });

  it("stores the terminal's note with its answer, and a blank one as none", async () => {
    const noted = await setup(terminal("merge", "Squash it").human);
    const notes: string[] = [];
    const onNote = (note: string): void => {
      notes.push(note);
    };
    expect(await noted.control.human.ask({ ...QUESTION, onNote })).toBe(
      "merge",
    );
    expect(noted.store.decision("r1-1")?.note).toBe("Squash it");
    expect(notes).toEqual(["Squash it"]);
    await noted.control.close();

    const blank = await setup(terminal("merge", "   ").human);
    await blank.control.human.ask({ ...QUESTION, onNote });
    expect(blank.store.decision("r1-1")).not.toHaveProperty("note");
    expect(blank.events.at(-1)).not.toHaveProperty("note");
    expect(notes).toEqual(["Squash it"]);
    await blank.control.close();
  });

  it("tells the session why a tool was denied when the person said", async () => {
    const { store, control } = await setup();
    const permit = control.human.permit({
      nodeId: "fix",
      toolName: "Bash",
      input: { command: "rm -rf build" },
    });
    store.answerDecision("r1-1", "deny", "decide", "Clean with git instead");
    control.check();
    expect(await permit).toEqual({
      allow: false,
      message:
        "The user did not allow this tool. They said: Clean with git instead",
    });
    await control.close();
  });

  it("closes a withdrawn permission prompt unanswered", async () => {
    const { store, events, control } = await setup();
    const withdraw = new AbortController();
    const answer = control.human.permit({
      nodeId: "n",
      toolName: "Bash",
      input: { command: "ls" },
      signal: withdraw.signal,
    });
    withdraw.abort();
    await expect(answer).rejects.toThrow("withdrawn");
    expect(store.decision("r1-1")?.status).toBe("withdrawn");
    expect(events.at(-1)?.type).toBe("decision.withdrawn");
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
      context: "rm -rf build",
    });
    store.answerDecision("r1-1", "deny", "decide");
    control.check();
    expect(await permit).toMatchObject({ allow: false });
    await control.close();
  });
});

/** Where the migration that adds decision notes is. */
const NOTES_MIGRATION = MIGRATIONS.findIndex(
  step => typeof step === "string" && step.includes("ADD COLUMN note"),
);

const ignore = (): void => {
  // Nothing in these tests stops or messages it.
};

/** A second process on the same run: the store and home of the first. */
const reopen = (store: EventStore, home: string, events: RunEvent[]) =>
  startControl({
    store,
    runId: "r1",
    home,
    intervalMs: 60_000,
    emit: event => {
      events.push(event);
    },
    onStop: ignore,
    onMessage: ignore,
  });

describe("a resumed run's decisions", () => {
  it("goes on from the ids stored, and withdraws what the last process left open", async () => {
    const { store, home, events, control } = await setup();
    const left = control.human.ask(QUESTION);
    left.catch(() => null);
    await control.close();

    const second = await reopen(store, home, events);
    const asked = second.human.ask(QUESTION);
    expect(store.decision("r1-1")).toMatchObject({ status: "withdrawn" });
    expect(store.decision("r1-2")).toMatchObject({ status: "open" });
    expect(store.answerDecision("r1-2", "merge", "decide")).toBe(true);
    expect(await wakeRun(socketPath("r1", home))).toBe(true);
    expect(await asked).toBe("merge");
    expect(events.map(e => e.type)).toEqual([
      "decision.opened",
      "decision.withdrawn",
      "decision.opened",
      "decision.answered",
    ]);
    await second.close();
  });
});

describe("decision notes in the store", () => {
  it("reads a decision answered before notes as one without a note", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ork-notes-"));
    const file = path.join(dir, "state.db");
    try {
      const db = new DatabaseSync(file);
      migrate(db, MIGRATIONS.slice(0, NOTES_MIGRATION));
      db.exec(`INSERT INTO runs (id, workflow, file, project, status, pid, started_at)
        VALUES ('old', 'w', '/p/w', '/p', 'succeeded', 0, '2026-01-01T00:00:00.000Z')`);
      db.exec(`INSERT INTO decisions (id, run_id, node, kind, question, options, opened_at,
          status, answer, answered_by, answered_at)
        VALUES ('old-1', 'old', 'gate', 'question', 'Merge?', '[{"id":"merge"}]',
          '2026-01-01', 'answered', 'merge', 'decide', '2026-01-01')`);
      db.close();
      const store = openStore(file);
      expect(store.decision("old-1")).toEqual({
        id: "old-1",
        runId: "old",
        node: "gate",
        kind: "question",
        question: "Merge?",
        options: [{ id: "merge" }],
        openedAt: "2026-01-01",
        status: "answered",
        answer: "merge",
        answeredBy: "decide",
        answeredAt: "2026-01-01",
      });
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("commands and the socket", () => {
  it("stops the run once when `ork stop` writes a command", async () => {
    const { store, events, control, stops } = await setup();
    store.command("r1", { kind: "stop" });
    store.command("r1", { kind: "stop" });
    control.check();
    expect(stops()).toBe(1);
    expect(events).toEqual([{ type: "run.command", command: "stop" }]);
    expect(store.takeCommands("r1")).toEqual([]);
    await control.close();
  });

  it("hands `ork chat` messages to the run", async () => {
    const { store, control, messages } = await setup();
    store.command("r1", { kind: "message", node: "fix", body: "use tabs" });
    control.check();
    expect(messages).toEqual(["fix: use tabs"]);
    await control.close();
  });

  it("streams the backlog and new events to a follower, and ends with the run", async () => {
    const { store, home, control } = await setup();
    const started: RunEvent = {
      type: "node.started",
      id: "a",
      nodeType: "agent.worker",
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
