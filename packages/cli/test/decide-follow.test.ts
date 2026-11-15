/**
 * @file Tests for `ork decide --follow`: the decisions open now asked first,
 *   then each one a run opens later (a run that started after it too), a
 *   decision answered elsewhere withdrawing its prompt with the attach line,
 *   Ctrl-C and `--until-idle` ending it without closing anything, `q` leaving a
 *   decision open, and the refusals (no terminal, flags that list or answer).
 *   With several live runs: one card at a time across them, the earlier opened
 *   of two asked first with no card up, what they open under a card asked once
 *   each in the order opened, `q` on one run, another run's decision answered
 *   or withdrawn elsewhere before its card, one that closed with no event seen
 *   dropped, the workflow and run filters, `--until-idle` past one run's end,
 *   and an ended run's open decision counted after Ctrl-C.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import type * as Core from "@krapht/ork-core";
import {
  answerDecision,
  type EventStore,
  followRuns,
  openStore,
  pendingDecisions,
  type RunEvent,
  storePath,
} from "@krapht/ork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { followRefusal } from "../src/commands/decide-list.ts";
import {
  followDecisions,
  type FollowFilter,
} from "../src/runs/follow-decisions.ts";
import { fakeTerm, type FakeTerm, KEY } from "./term-fake.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

/** The decisions whose `decision.opened` `followRuns` has passed on. */
const delivered = vi.hoisted(() => new Set<string>());

// `followRuns` as it is, watched: a test can wait for a pass to end idle, or
// for a decision to have reached `ork decide`.
vi.mock("@krapht/ork-core", async importOriginal => {
  const core = await importOriginal<typeof Core>();
  return {
    ...core,
    followRuns: vi.fn<typeof core.followRuns>(
      (store, scope, onEvent, options) =>
        core.followRuns(
          store,
          scope,
          event => {
            const { event: e } = event.stored;
            if (e.type === "decision.opened") delivered.add(e.decision);
            onEvent(event);
          },
          options,
        ),
    ),
  };
});

/** How many passes of `followRuns` have ended idle so far. */
const idlePasses = () =>
  vi
    .mocked(followRuns)
    .mock.settledResults.filter(
      r => r.type === "fulfilled" && r.value === "idle",
    ).length;

const finished = (runId: string): RunEvent => ({
  type: "run.finished",
  result: {
    runId,
    status: "succeeded",
    costUsd: 0,
    nodes: [],
    reasons: [],
    worktrees: [],
  },
});

/** A run recorded by this process, so it reads as running until it ends. */
const begin = (
  store: EventStore,
  id: string,
  workflow = "w",
  project = "/p",
): void => {
  store.begin({ id, workflow, file: "f", project });
  store.append(id, {
    type: "run.started",
    runId: id,
    workflow,
    entries: [],
    nodes: [{ id: "gate", type: "human.gate" }],
  });
};

const open = (
  store: EventStore,
  run: string,
  id: string,
  append: (run: string, event: RunEvent) => void = (r, e) => {
    store.append(r, e);
  },
): void => {
  const options = [{ id: "approve" }, { id: "revise" }];
  store.openDecision({
    id,
    runId: run,
    node: "gate",
    kind: "question",
    question: `Approve ${id}?`,
    options,
  });
  append(run, {
    type: "decision.opened",
    node: "gate",
    decision: id,
    kind: "question",
    question: `Approve ${id}?`,
    options,
  });
};

/**
 * `store` as followed (`timed`), and `appendAt`, which stores an event that
 * reads as stored `ms` after this was made: an event read first can read as
 * stored later, as when another run is polled later (RFC-020).
 */
const stampedStore = (store: EventStore) => {
  const base = Date.now();
  /** A stamped event's `at`, by `run:seq`. */
  const stamps = new Map<string, string>();
  const timed: EventStore = {
    ...store,
    events: (run, after) =>
      // Each read is a fresh copy from the store, so stamping it in place is safe.
      store.events(run, after).map(stored =>
        Object.assign(stored, {
          at: stamps.get(`${run}:${String(stored.seq)}`) ?? stored.at,
        }),
      ),
  };
  const appendAt = (run: string, event: RunEvent, ms: number): void => {
    const { seq } = store.append(run, event);
    stamps.set(`${run}:${String(seq)}`, new Date(base + ms).toISOString());
  };
  return { timed, appendAt };
};

describe("ork decide --follow, in process", () => {
  let store: EventStore;
  let term: FakeTerm;
  let lines: string[];
  let controller: AbortController;
  let home: string;

  const follow = (
    untilIdle = false,
    filter: FollowFilter = {},
    followed = store,
  ) =>
    followDecisions(followed, pendingDecisions(store, filter), filter, {
      out: line => {
        lines.push(stripVTControlCharacters(line));
      },
      home,
      intervalMs: 5,
      untilIdle,
      signal: controller.signal,
      terminal: {
        input: term.io.input,
        output: term.io.output,
        interactive: true,
        env: {},
      },
    });
  const onScreen = (text: string) =>
    vi.waitFor(() => {
      expect(term.screen().join("\n")).toContain(text);
    });
  const printed = (text: string) =>
    vi.waitFor(() => {
      expect(lines.join("\n")).toContain(text);
    });
  /** Opens each `[run, decision]` in order. */
  const openAll = (decisions: readonly (readonly [string, string])[]) => {
    for (const [run, id] of decisions) open(store, run, id);
  };
  /** Whether the terminal ever drew `decision`'s card. */
  const drawn = (id: string) =>
    stripVTControlCharacters(term.raw()).includes(`Approve ${id}?`);

  beforeEach(() => {
    store = openStore(":memory:");
    term = fakeTerm({ columns: 70 });
    lines = [];
    controller = new AbortController();
    home = mkdtempSync(path.join(tmpdir(), "ork-decide-follow-"));
    delivered.clear();
    begin(store, "live0000");
  });
  afterEach(() => {
    controller.abort();
    store.close();
  });

  it("asks the open decisions first, then a new one, naming run and workflow, answering as decide", async () => {
    open(store, "live0000", "live-1");
    const done = follow();
    await onScreen("Approve live-1?");
    expect(term.screen().join("\n")).toContain("run live0000 · w");
    await term.press(KEY.enter);

    // A run that began after following did, with its own decision.
    begin(store, "later000", "other");
    open(store, "later000", "later-1");
    await onScreen("Approve later-1?");
    expect(term.screen().join("\n")).toContain("run later000 · other");
    await term.press(KEY.enter);

    await vi.waitFor(() => {
      expect(store.decision("later-1")?.status).toBe("answered");
    });
    expect(store.decision("live-1")).toMatchObject({
      status: "answered",
      answeredBy: "decide",
    });
    controller.abort();
    await expect(done).resolves.toBe("aborted");
  });

  it("asks a decision opened later in a run it already follows, once", async () => {
    const done = follow();
    await vi.waitFor(() => {
      expect(term.screen()).toEqual([]);
    });
    open(store, "live0000", "live-1");
    await onScreen("Approve live-1?");
    await term.press(KEY.enter);
    await vi.waitFor(() => {
      expect(store.decision("live-1")?.status).toBe("answered");
    });
    controller.abort();
    await done;

    expect(store.decisions({ status: "open" })).toEqual([]);
  });

  it("withdraws a prompt answered elsewhere and says so", async () => {
    open(store, "live0000", "live-1");
    const done = follow();
    await onScreen("Approve live-1?");
    await answerDecision(store, "live-1", "revise", home, "ui");
    store.append("live0000", {
      type: "decision.answered",
      node: "gate",
      decision: "live-1",
      answer: "revise",
      by: "ui",
    });

    await printed("live-1 answered elsewhere: revise (");
    expect(store.decision("live-1")?.answeredBy).toBe("ui");
    controller.abort();
    await done;
  });

  it("ends on Ctrl-C at a prompt, closing nothing, and counts what is left", async () => {
    open(store, "live0000", "live-1");
    const done = follow();
    await onScreen("Approve live-1?");
    await term.press(KEY.ctrlC);

    await expect(done).resolves.toBe("aborted");
    expect(lines).toContain("stopped following; 1 decision(s) still open");
    expect(store.decision("live-1")?.status).toBe("open");
    expect(store.lookup("live0000")[0]?.status).toBe("running");
  });

  it("ends on Ctrl-C at a prompt that is still open once nothing is live", async () => {
    open(store, "live0000", "live-1");
    const done = follow(true);
    await onScreen("Approve live-1?");
    store.append("live0000", finished("live0000"));
    // Following has gone idle; the prompt on screen is all that is left.
    await vi.waitFor(() => {
      expect(vi.mocked(followRuns).mock.settledResults).toContainEqual({
        type: "fulfilled",
        value: "idle",
      });
    });
    await term.press(KEY.ctrlC);

    await expect(done).resolves.toBe("aborted");
    expect(lines).toContain("stopped following; 1 decision(s) still open");
    expect(store.decision("live-1")?.status).toBe("open");
  });

  it.each([
    ["workflow", { workflow: "w" }, "other000", "x", "/p"],
    ["run", { runId: "live0000" }, "other000", "w", "/p"],
    ["project", { project: "/p" }, "other000", "w", "/elsewhere"],
  ] satisfies [string, FollowFilter, string, string, string][])(
    "asks only what the %s filter keeps, and leaves the rest open",
    async (_name, filter, other, workflow, project) => {
      open(store, "live0000", "live-1");
      const done = follow(false, filter);
      await onScreen("Approve live-1?");
      // A live run outside the filter opens a decision; the one in scope next.
      begin(store, other, workflow, project);
      open(store, other, "out-1");
      await term.press(KEY.enter);
      await vi.waitFor(() => {
        expect(store.decision("live-1")?.status).toBe("answered");
      });
      open(store, "live0000", "live-2");
      await onScreen("Approve live-2?");
      expect(term.screen().join("\n")).not.toContain("out-1");
      await term.press(KEY.enter);
      await vi.waitFor(() => {
        expect(store.decision("live-2")?.status).toBe("answered");
      });
      controller.abort();
      await done;

      expect(store.decision("out-1")?.status).toBe("open");
      expect(lines).not.toContain("Approve out-1?");
    },
  );

  it("leaves a decision open on q and does not ask it again", async () => {
    open(store, "live0000", "live-1");
    const done = follow(true);
    await onScreen("Approve live-1?");
    await term.press("q");
    store.append("live0000", finished("live0000"));

    await expect(done).resolves.toBe("idle");
    expect(store.decision("live-1")?.status).toBe("open");
    expect(lines).toContain("no live runs");
  });

  it("with --until-idle waits for the run to end and for the prompt to settle", async () => {
    open(store, "live0000", "live-1");
    const done = follow(true);
    await onScreen("Approve live-1?");
    store.append("live0000", finished("live0000"));
    await term.press(KEY.enter);

    await expect(done).resolves.toBe("idle");
    expect(store.decision("live-1")?.status).toBe("answered");
    expect(lines.at(-1)).toBe("no live runs");
  });

  it("with --until-idle ends at once when no run is live", async () => {
    store.append("live0000", finished("live0000"));

    await expect(follow(true)).resolves.toBe("idle");
    expect(lines).toEqual(["no live runs"]);
  });

  describe("ork decide --follow, several runs", () => {
    // Run A is `live0000` (workflow `w`); B and C start beside it.
    const A = "live0000";
    const B = "bbbb0000";
    const C = "cccc0000";
    /** A run A calls, begun only by the test that needs it. */
    const D = "dddd0000";
    const WORKFLOW: Record<string, string> = {
      [A]: "w",
      [B]: "wb",
      [C]: "wc",
      [D]: "wd",
    };

    beforeEach(() => {
      begin(store, B, WORKFLOW[B]);
      begin(store, C, WORKFLOW[C]);
    });

    /**
     * Answers `run`'s card for `id` with Enter: it names its run and workflow,
     * and none of the `rest` (not yet answered) is up before it is answered.
     */
    const answerOne = async (
      run: string,
      id: string,
      rest: readonly string[] = [],
    ) => {
      await onScreen(`Approve ${id}?`);
      const screen = term.screen().join("\n");
      expect(screen).toContain(`run ${run} · ${WORKFLOW[run]}`);
      expect(
        rest.filter(other => screen.includes(`Approve ${other}?`)),
      ).toEqual([]);
      await term.press(KEY.enter);
      await vi.waitFor(() => {
        expect(store.decision(id)?.status).toBe("answered");
      });
    };
    /** Answers each `[run, decision]` card, in this order. */
    const answer = async (cards: readonly (readonly [string, string])[]) => {
      for (const [i, [run, id]] of cards.entries()) {
        // oxlint-disable-next-line no-await-in-loop -- one card at a time
        await answerOne(
          run,
          id,
          cards.slice(i + 1).map(([, other]) => other),
        );
      }
    };

    it("asks each run's open decision, one card at a time, answering as decide", async () => {
      const cards = [
        [A, "a-1"],
        [B, "b-1"],
        [C, "c-1"],
      ] as const;
      openAll(cards);
      const done = follow();
      await answer(cards);
      controller.abort();
      await expect(done).resolves.toBe("aborted");

      expect(cards.map(([, id]) => store.decision(id)?.answeredBy)).toEqual([
        "decide",
        "decide",
        "decide",
      ]);
      expect(lines).toContain("stopped following; 0 decision(s) still open");
    });

    it("with no card up, asks first the decision opened earlier, though another run's arrives first", async () => {
      const { timed, appendAt } = stampedStore(store);
      const done = follow(false, {}, timed);
      // One read of A's events brings its decision, then the call that finds
      // D, whose decision opened before A's.
      store.begin({
        id: D,
        workflow: "wd",
        file: "f",
        project: "/p",
        parent: A,
      });
      appendAt(
        D,
        {
          type: "run.started",
          runId: D,
          workflow: "wd",
          entries: [],
          nodes: [],
        },
        10,
      );
      open(store, A, "a-1", (run, event) => {
        appendAt(run, event, 30);
      });
      appendAt(
        A,
        {
          type: "call.started",
          node: "gate",
          run: D,
          workflow: "wd",
          project: "/p",
        },
        35,
      );
      open(store, D, "d-1", (run, event) => {
        appendAt(run, event, 20);
      });
      await answer([
        [D, "d-1"],
        [A, "a-1"],
      ]);
      controller.abort();

      await expect(done).resolves.toBe("aborted");
    });

    it("queues what the other runs open while a card is up, each asked once, in order", async () => {
      openAll([[A, "a-1"]]);
      const done = follow();
      await onScreen("Approve a-1?");
      const later = [
        [B, "b-1"],
        [C, "c-1"],
        [A, "a-2"],
        [B, "b-2"],
      ] as const;
      openAll(later);
      // Each run is polled apart: all four reach `ork decide` under a-1's card.
      await vi.waitFor(() => {
        expect([...delivered]).toEqual(
          expect.arrayContaining(later.map(([, id]) => id)),
        );
      });
      await answer([[A, "a-1"], ...later]);
      // Asked twice, a decision would be up before this one.
      openAll([[C, "c-2"]]);
      await answer([[C, "c-2"]]);
      controller.abort();
      await done;

      expect(store.decisions({ status: "open" })).toEqual([]);
    });

    it("leaves one run's decision open on q, asks the others, and counts it", async () => {
      openAll([
        [A, "a-1"],
        [B, "b-1"],
        [C, "c-1"],
      ]);
      const done = follow();
      await answer([[A, "a-1"]]);
      await onScreen("Approve b-1?");
      await term.press("q");
      await answer([[C, "c-1"]]);
      controller.abort();
      await expect(done).resolves.toBe("aborted");

      expect(store.decision("b-1")?.status).toBe("open");
      expect(lines.at(-1)).toBe("stopped following; 1 decision(s) still open");
    });

    it("withdraws another run's decision answered elsewhere before it is shown", async () => {
      openAll([
        [A, "a-1"],
        [B, "b-1"],
        [C, "c-1"],
      ]);
      const done = follow();
      await onScreen("Approve a-1?");
      await answerDecision(store, "b-1", "revise", home, "ui");
      store.append(B, {
        type: "decision.answered",
        node: "gate",
        decision: "b-1",
        answer: "revise",
        by: "ui",
      });
      await printed("b-1 answered elsewhere: revise (ork ui)");
      await answer([
        [A, "a-1"],
        [C, "c-1"],
      ]);
      controller.abort();
      await done;

      expect(drawn("b-1")).toBe(false);
      expect(store.decision("b-1")?.answeredBy).toBe("ui");
    });

    it("withdraws another run's decision withdrawn before it is shown, saying so", async () => {
      openAll([
        [A, "a-1"],
        [B, "b-1"],
        [C, "c-1"],
      ]);
      const done = follow();
      await onScreen("Approve a-1?");
      store.withdrawDecision("b-1");
      store.append(B, {
        type: "decision.withdrawn",
        node: "gate",
        decision: "b-1",
      });
      await printed("b-1 withdrawn");
      await answer([
        [A, "a-1"],
        [C, "c-1"],
      ]);
      controller.abort();
      await done;

      expect(drawn("b-1")).toBe(false);
      expect(store.decision("b-1")?.status).toBe("withdrawn");
    });

    it("drops a held decision that closed with no event seen, never asking it, and still ends idle", async () => {
      openAll([
        [A, "a-1"],
        [B, "b-1"],
        [C, "c-1"],
      ]);
      const done = follow(true);
      await onScreen("Approve a-1?");
      // Answered elsewhere, but no `decision.answered` reaches `ork decide`.
      await answerDecision(store, "b-1", "revise", home, "ui");
      await answer([
        [A, "a-1"],
        [C, "c-1"],
      ]);
      for (const run of [A, B, C]) store.append(run, finished(run));

      // Held and never dropped, b-1 would keep it from ending.
      await expect(done).resolves.toBe("idle");
      expect(drawn("b-1")).toBe(false);
      expect(lines.filter(line => line.includes("b-1"))).toEqual([]);
    });

    it.each([
      ["workflow", { workflow: "wc" }, C, "c", ["a-1", "a-2", "b-1", "b-2"]],
      ["run", { runId: B }, B, "b", ["a-1", "a-2", "c-1", "c-2"]],
    ] satisfies [string, FollowFilter, string, string, string[]][])(
      "asks only the runs the %s filter keeps",
      async (_name, filter, run, letter, out) => {
        openAll([
          [A, "a-1"],
          [B, "b-1"],
          [C, "c-1"],
        ]);
        const done = follow(false, filter);
        await onScreen(`Approve ${letter}-1?`);
        // Out of scope, a decision drawn would be up before the last one.
        openAll([
          [A, "a-2"],
          [B, "b-2"],
          [C, "c-2"],
        ]);
        await answer([
          [run, `${letter}-1`],
          [run, `${letter}-2`],
        ]);
        controller.abort();
        await done;

        expect(
          store
            .decisions({ status: "open" })
            .map(d => d.id)
            .toSorted(),
        ).toEqual(out);
        expect(out.filter(id => drawn(id))).toEqual([]);
      },
    );

    it("with --until-idle follows on after one run ends, until the last ends and its card settles", async () => {
      openAll([
        [A, "a-1"],
        [B, "b-1"],
      ]);
      const ended = vi.fn<(end: string) => void>();
      const done = follow(true).then(end => {
        ended(end);
        return end;
      });
      await onScreen("Approve a-1?");
      store.append(A, finished(A));
      store.append(C, finished(C));
      await answer([
        [A, "a-1"],
        [B, "b-1"],
      ]);
      // B is still live: what it opens next is asked.
      openAll([[B, "b-2"]]);
      await onScreen("Approve b-2?");
      const before = idlePasses();
      store.append(B, finished(B));
      // Following has gone idle; the card on screen is all that is left.
      await vi.waitFor(() => {
        expect(idlePasses()).toBeGreaterThan(before);
      });
      expect(ended).not.toHaveBeenCalled();
      await term.press(KEY.enter);

      await expect(done).resolves.toBe("idle");
      expect(store.decision("b-2")?.status).toBe("answered");
      expect(lines.at(-1)).toBe("no live runs");
    });

    it("counts a decision an ended run left open after Ctrl-C, and does not ask it again", async () => {
      openAll([
        [A, "a-1"],
        [B, "b-1"],
      ]);
      const done = follow();
      await onScreen("Approve a-1?");
      await term.press("q");
      store.append(A, finished(A));
      await answer([[B, "b-1"]]);
      // Asked again, a-1 would be up before this one.
      openAll([[B, "b-2"]]);
      await onScreen("Approve b-2?");
      await term.press(KEY.ctrlC);

      await expect(done).resolves.toBe("aborted");
      expect(store.decision("a-1")?.status).toBe("open");
      expect(lines.at(-1)).toBe("stopped following; 2 decision(s) still open");
    });
  });
});

describe("ork decide --follow, flags", () => {
  let home: string;

  const ork = (args: readonly string[]) =>
    spawnSync(process.execPath, [BIN, "decide", ...args], {
      cwd: home,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: home,
        ORK_NO_UPDATE_CHECK: "1",
      },
    });

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "ork-decide-follow-flags-"));
    openStore(storePath(home)).close();
  });

  it("refuses without a terminal, and --watch is --follow", () => {
    for (const flag of ["--follow", "--watch"]) {
      const done = ork([flag]);
      expect(done.status).toBe(1);
      expect(done.stderr).toContain("--follow needs a terminal");
    }
  });

  it.each([
    ["--list"],
    ["--json"],
    ["--ids"],
    ["--limit", "2"],
    ["--id", "x"],
    ["--choose", "a"],
    ["--document"],
    ["--say", "hi"],
    ["--note", "hi"],
    ["--rating", "good"],
  ])("refuses --follow with %s in one line", (...flags) => {
    const done = ork(["--follow", ...flags]);
    expect(done.status).toBe(1);
    expect(done.stderr.trim().split("\n")).toHaveLength(1);
    expect(done.stderr).toContain(`it can't go with ${flags[0]}`);
  });

  it("refuses --until-idle without --follow, and accepts the plain flags", () => {
    expect(ork(["--until-idle"]).stderr).toContain(
      "--until-idle goes with --follow",
    );
    expect(followRefusal({ follow: true, project: "all", run: "r1" })).toBe(
      undefined,
    );
    expect(followRefusal({ follow: false, list: true })).toBeUndefined();
  });
});
