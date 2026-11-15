/**
 * @file Tests for `createPrompts`, the queue `ork attach` and `ork decide
 *   --follow` share: decisions that arrive while a card is up are asked in the
 *   order they opened, a card withdrawn elsewhere prints its line before the
 *   next card is drawn, a held decision closed elsewhere is said and never
 *   drawn, a held decision no longer open is dropped (no leak), and the first
 *   decision to arrive with no card up is asked at once (specs/gaps L383).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { type EventStore, openStore, type RunEvent } from "@krapht/ork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTerminalHuman, type TerminalHuman } from "../src/human.ts";
import { createPrompts, type Prompts } from "../src/runs/prompts.ts";
import { termOf } from "../src/term/mode.ts";
import { fakeTerm, type FakeTerm, KEY } from "./term-fake.ts";

/** A line printed, and the screen at that moment. */
type Printed = { line: string; screen: string };

const question = (id: string): string => `Question ${id}?`;

const answered = (id: string): RunEvent => ({
  type: "decision.answered",
  node: "gate",
  decision: id,
  answer: "revise",
  by: "decide",
});

const withdrawn = (id: string): RunEvent => ({
  type: "decision.withdrawn",
  node: "gate",
  decision: id,
});

describe("createPrompts", () => {
  let store: EventStore;
  let term: FakeTerm;
  let human: TerminalHuman;
  let prompts: Prompts;
  let home: string;
  let printed: Printed[];

  /** Opens decision `id`, in the store's order of opening. */
  const open = (id: string): void => {
    store.openDecision({
      id,
      runId: "run00000",
      node: "gate",
      kind: "question",
      question: question(id),
      options: [{ id: "approve" }, { id: "revise" }],
    });
  };
  const ask = (...ids: string[]): void => {
    for (const id of ids) prompts.ask({ run: "run00000" }, id);
  };
  /** Closes `id` elsewhere, as another answerer does, and feeds the event. */
  const closeElsewhere = (
    kind: "answered" | "withdrawn",
    id: string,
  ): boolean => {
    if (kind === "answered") store.answerDecision(id, "revise", "decide");
    else store.withdrawDecision(id);
    return prompts.seen(kind === "answered" ? answered(id) : withdrawn(id));
  };
  const lines = (): string[] => printed.map(p => p.line);
  const screenHas = (text: string) =>
    vi.waitFor(() => {
      expect(term.screen().join("\n")).toContain(text);
    });
  const screenLacks = (text: string) => {
    expect(term.screen().join("\n")).not.toContain(text);
  };
  const lineAt = (text: string): Printed | undefined =>
    printed.find(p => p.line.includes(text));
  /** Picks the first option of the card on screen. */
  const pick = async (id: string): Promise<void> => {
    await screenHas(question(id));
    await term.press(KEY.enter);
    await vi.waitFor(() => {
      expect(store.decision(id)?.status).toBe("answered");
    });
  };

  beforeEach(() => {
    store = openStore(":memory:");
    store.begin({ id: "run00000", workflow: "w", file: "f", project: "/p" });
    term = fakeTerm({ columns: 70 });
    home = mkdtempSync(join(tmpdir(), "ork-prompts-"));
    printed = [];
    human = createTerminalHuman({
      input: term.io.input,
      output: term.io.output,
      interactive: true,
      env: {},
    });
    prompts = createPrompts(store, human, {
      home,
      out: line => {
        printed.push({
          line: stripVTControlCharacters(line),
          screen: term.screen().join("\n"),
        });
      },
      term: termOf(term.io.output, {}),
    });
  });
  afterEach(() => {
    prompts.abort();
    human.close();
    store.close();
    rmSync(home, { recursive: true, force: true });
  });

  it("asks decisions that arrive under a card in the order they opened", async () => {
    for (const id of ["a", "b", "c"]) open(id);
    // Poll order: the last opened arrives first.
    ask("a", "c", "b");
    expect(prompts.open()).toBe(3);

    await pick("a");
    await screenHas(question("b"));
    screenLacks(question("c"));
    await pick("b");
    await pick("c");
    await prompts.settled();

    expect(prompts.open()).toBe(0);
  });

  it("asks the first decision to arrive at once, even if another opened earlier", async () => {
    open("a");
    open("b");
    ask("b");

    await screenHas(question("b"));
    expect(term.screen().join("\n")).not.toContain(question("a"));
  });

  it("does not ask a decision it holds, is asking or has had answered", async () => {
    for (const id of ["a", "b"]) open(id);
    ask("a", "b", "b", "a");

    expect(prompts.open()).toBe(2);
    expect(prompts.has("b")).toBe(true);
    await pick("a");
    await pick("b");
    await prompts.settled();
    ask("a", "b");

    expect(prompts.has("a")).toBe(true);
    expect(prompts.open()).toBe(0);
  });

  it.each([
    ["answered", "a answered elsewhere: revise (ork decide)"],
    ["withdrawn", "a withdrawn"],
  ] as const)(
    "prints a card %s elsewhere before it draws the next card",
    async (kind, text) => {
      for (const id of ["a", "b"]) open(id);
      ask("a", "b");
      await screenHas(question("a"));

      expect(closeElsewhere(kind, "a")).toBe(true);
      await screenHas(question("b"));

      expect(lineAt(text)?.screen).not.toContain(question("b"));
      expect(lines()).toEqual([text]);
    },
  );

  it.each([
    ["answered", "b answered elsewhere: revise (ork decide)"],
    ["withdrawn", "b withdrawn"],
  ] as const)(
    "says a held decision %s elsewhere at once and never draws it",
    async (kind, text) => {
      for (const id of ["a", "b"]) open(id);
      ask("a", "b");
      await screenHas(question("a"));

      expect(closeElsewhere(kind, "b")).toBe(true);

      // Before the card on screen settles.
      expect(lineAt(text)?.screen).toContain(question("a"));
      expect(prompts.open()).toBe(1);
      expect(prompts.has("b")).toBe(false);
      await pick("a");
      await prompts.settled();

      expect(term.raw()).not.toContain(question("b"));
      expect(lines()).toEqual([text]);
      expect(prompts.open()).toBe(0);
    },
  );

  it("drops a held decision that is no longer open without an event", async () => {
    for (const id of ["a", "b"]) open(id);
    ask("a", "b");
    await screenHas(question("a"));
    store.answerDecision("b", "revise", "decide");

    await pick("a");
    await prompts.settled();

    expect(term.raw()).not.toContain(question("b"));
    expect(lines()).toEqual([]);
    expect(prompts.open()).toBe(0);
    expect(prompts.has("b")).toBe(false);
  });

  it("drops the held decisions when following is over", async () => {
    for (const id of ["a", "b"]) open(id);
    ask("a", "b");
    await screenHas(question("a"));

    prompts.abort();
    await prompts.settled();

    expect(term.raw()).not.toContain(question("b"));
    expect(prompts.open()).toBe(0);
    expect(store.decision("b")?.status).toBe("open");
  });
});
