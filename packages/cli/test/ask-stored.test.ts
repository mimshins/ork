/**
 * @file Tests for `askStored` on a fake terminal: an answer is stored with who
 *   gave it, `q` leaves the decision open, an abort withdraws the prompt, and a
 *   late answer is refused with `answerDecision`'s message and not stored.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type DecisionRecord,
  type EventStore,
  openStore,
  storePath,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { createTerminalHuman } from "../src/human.ts";
import { type Asked, askStored } from "../src/runs/ask-stored.ts";
import { fakeTerm, type FakeTerm, KEY } from "./term-fake.ts";

type Setup = {
  home: string;
  store: EventStore;
  decision: DecisionRecord;
  term: FakeTerm;
  ask: (signal?: AbortSignal) => Promise<Asked>;
};

/** A store whose run `r1` waits on decision `r1-1`, and a terminal to ask it on. */
const setup = (): Setup => {
  const home = mkdtempSync(path.join(tmpdir(), "ork-ask-stored-"));
  const store = openStore(storePath(home));
  store.begin({
    id: "r1",
    workflow: "w",
    file: "/p/w.ork.yaml",
    project: "/p",
  });
  store.append("r1", {
    type: "node.started",
    id: "approve",
    nodeType: "human.gate",
    round: 1,
  });
  store.openDecision({
    id: "r1-1",
    runId: "r1",
    node: "approve",
    kind: "question",
    question: "Approve the spec?",
    options: [{ id: "approve" }, { id: "revise" }],
  });
  const decision = store.decision("r1-1");
  if (decision === undefined) throw new Error("decision was not opened");
  const term = fakeTerm({ columns: 60 });
  const human = createTerminalHuman({
    input: term.io.input,
    output: term.io.output,
    interactive: true,
    env: {},
  });
  const ask = (signal?: AbortSignal): Promise<Asked> =>
    askStored(store, human, decision, {
      by: "terminal",
      home,
      place: { run: "r1", decision: "r1-1", index: 1, total: 1 },
      ...(signal === undefined ? {} : { signal }),
    });
  return { home, store, decision, term, ask };
};

describe("askStored", () => {
  it("stores the chosen option as answered by the terminal", async () => {
    const { store, term, ask } = setup();
    const asked = ask();
    await term.press(KEY.down, KEY.enter);
    expect(await asked).toEqual({ kind: "answered", choice: "revise" });
    expect(store.decision("r1-1")).toMatchObject({
      status: "answered",
      answer: "revise",
      answeredBy: "terminal",
    });
  });

  it("leaves the decision open on q", async () => {
    const { store, term, ask } = setup();
    const asked = ask();
    await term.press("q");
    expect(await asked).toEqual({ kind: "later" });
    expect(store.decision("r1-1")?.status).toBe("open");
  });

  it("returns withdrawn when the signal aborts the prompt, storing nothing", async () => {
    const { store, term, ask } = setup();
    const controller = new AbortController();
    const asked = ask(controller.signal);
    await term.press();
    controller.abort();
    expect(await asked).toEqual({ kind: "withdrawn" });
    expect(store.decision("r1-1")?.status).toBe("open");
  });

  it("refuses a late answer with answerDecision's message and keeps the first", async () => {
    const { store, term, ask } = setup();
    const asked = ask();
    await term.press();
    store.answerDecision("r1-1", "revise", "decide");
    await term.press(KEY.enter);
    expect(await asked).toEqual({
      kind: "refused",
      message: "r1-1 was already answered: revise (decide)",
    });
    expect(store.decision("r1-1")).toMatchObject({
      answer: "revise",
      answeredBy: "decide",
    });
  });
});
