/**
 * @file Tests that Claude nodes running at the same time are not offered the
 *   same part of a run's budget (ADR-077): each sets aside the cap it starts
 *   with, a node with nothing left waits for one running beside it to finish,
 *   and a node lets its reserve go when its session ends. A run's budget in
 *   tokens (RFC-015) is kept the same way.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type AgentRuntime,
  countedTokens,
  type ExecuteContext,
  type RuntimeEvent,
  type SessionSpec,
} from "@krapht/ork-core";
import type { Node, Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { claudeExecutor } from "../src/index.ts";

const usage = {
  costUsd: 0.5,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 1,
};

/**
 * Reserves in one unit as the scheduler keeps them: a wait is worth it only
 * while another node that is not a leader holds one (`reserves.freed`).
 */
const reserveBook = () => {
  const reserves = new Map<string, number>();
  const leaders = new Set<string>();
  const waiters: (() => void)[] = [];
  const reserve = (id: string, amount: number | undefined) => {
    const before = reserves.get(id) ?? 0;
    reserves.set(id, amount ?? 0);
    if ((amount ?? 0) < before) for (const wake of waiters.splice(0)) wake();
  };
  const held = () => [...reserves.values()].reduce((a, b) => a + b, 0);
  const freed = (id: string): Promise<boolean> =>
    [...reserves].some(
      ([other, amount]) => other !== id && amount > 0 && !leaders.has(other),
    )
      ? new Promise(resolve => {
          waiters.push(() => {
            resolve(true);
          });
        })
      : Promise.resolve(false);
  return { reserves, leaders, reserve, held, freed };
};

/**
 * A run's budget as the scheduler keeps it: spent, and what is set aside.
 * `spentIn` is the `budgetSpentIn` hook, for a test to add.
 */
const budgetBook = (budgetUsd: number) => {
  let spent = 0;
  const { reserves, leaders, reserve, held, freed } = reserveBook();
  const left = () => budgetUsd - spent - held();
  const hooks = (id: string): Partial<ExecuteContext> => ({
    budgetLeftUsd: left(),
    budgetLeftNow: left,
    reserveBudget: usd => {
      reserve(id, usd);
    },
    budgetFreed: () => freed(id),
    emit: (event: RuntimeEvent) => {
      if (event.type === "session.finished")
        spent += event.outcome.usage.costUsd;
    },
  });
  const spentIn = (unit: "usd" | "tokens") =>
    unit === "usd" && spent >= budgetUsd;
  return { hooks, reserves, leaders, reserve, spentIn };
};

/** A run's `limits.budgetTokens` as the scheduler keeps it. */
const tokenBook = (budgetTokens: number) => {
  let used = 0;
  const { reserves, leaders, reserve, held, freed } = reserveBook();
  const hooks = (id: string): Partial<ExecuteContext> => ({
    tokensLeftNow: () => budgetTokens - used - held(),
    reserveTokens: tokens => {
      reserve(id, tokens);
    },
    budgetFreed: () => freed(id),
    emit: (event: RuntimeEvent) => {
      if (event.type === "session.finished")
        used += countedTokens(event.outcome.usage);
    },
  });
  const spentIn = (unit: "usd" | "tokens") =>
    unit === "tokens" && used >= budgetTokens;
  return { hooks, reserves, leaders, reserve, spentIn };
};

/**
 * A run's budget in dollars and tokens together, as the scheduler keeps it: a
 * wait is worth it only while another node, not a leader, holds a reserve of
 * either unit.
 */
const bothBook = (budgetUsd: number, budgetTokens: number) => {
  const spent = { usd: 0, tokens: 0 };
  const reserves = new Map<string, { usd: number; tokens: number }>();
  const leaders = new Set<string>();
  const waiters: (() => void)[] = [];
  const held = (unit: "usd" | "tokens") =>
    [...reserves.values()].reduce((sum, r) => sum + r[unit], 0);
  const reserve = (id: string, unit: "usd" | "tokens", amount = 0) => {
    const now = reserves.get(id) ?? { usd: 0, tokens: 0 };
    reserves.set(id, { ...now, [unit]: amount });
    if (amount < now[unit]) for (const wake of waiters.splice(0)) wake();
  };
  const hooks = (id: string): Partial<ExecuteContext> => ({
    budgetLeftUsd: budgetUsd,
    budgetLeftNow: () => budgetUsd - spent.usd - held("usd"),
    tokensLeftNow: () => budgetTokens - spent.tokens - held("tokens"),
    reserveBudget: usd => {
      reserve(id, "usd", usd);
    },
    reserveTokens: tokens => {
      reserve(id, "tokens", tokens);
    },
    budgetFreed: () =>
      [...reserves].some(
        ([other, r]) =>
          other !== id && !leaders.has(other) && r.usd + r.tokens > 0,
      )
        ? new Promise(resolve => {
            waiters.push(() => {
              resolve(true);
            });
          })
        : Promise.resolve(false),
    emit: (event: RuntimeEvent) => {
      if (event.type !== "session.finished") return;
      spent.usd += event.outcome.usage.costUsd;
      spent.tokens += countedTokens(event.outcome.usage);
    },
  });
  return { hooks, reserves, leaders, reserve };
};

/** A runtime whose sessions stay open until `finish` lets the oldest one go. */
const heldRuntime = () => {
  const specs: SessionSpec[] = [];
  const open: (() => void)[] = [];
  const runtime: AgentRuntime = {
    driver: "claude-code",
    start: spec => {
      specs.push(spec);
      const ended = new Promise<void>(resolve => {
        open.push(resolve);
      });
      return {
        events: (async function* () {
          await ended;
          yield {
            type: "session.finished" as const,
            outcome: {
              subtype: "success" as const,
              sessionId: `s${String(specs.length)}`,
              report: {
                status: "pass",
                summary: "ok",
                artifacts: {},
                fields: {},
              },
              text: "",
              usage,
              errors: [],
            },
          };
        })(),
        send: () => {},
        interrupt: () => Promise.resolve(),
      };
    },
  };
  const finish = () => {
    open.shift()?.();
  };
  return { runtime, specs, finish };
};

/** A runtime whose every session ends at its cap, with `asked` its specs. */
const usedUp = (asked: SessionSpec[], used = usage): AgentRuntime => ({
  driver: "claude-code",
  start: spec => {
    asked.push(spec);
    return {
      events: (async function* () {
        await Promise.resolve();
        yield {
          type: "session.finished" as const,
          outcome: {
            subtype: "error_max_budget_tokens",
            end: { kind: "budget_limit" as const, message: "spent" },
            sessionId: "s",
            report: null,
            text: "",
            usage: used,
            errors: [],
          },
        };
      })(),
      send: () => {},
      interrupt: () => Promise.resolve(),
    };
  },
});

const WORKER: Node = { type: "agent.worker", prompt: "Build", budgetUsd: 3 };

const NO_DOLLARS =
  "nothing is left to start with: the run's budget is spent or set aside by running sessions";

const NO_TOKENS =
  "nothing is left to start with: the run's tokens are spent or set aside by running sessions";

const contextFor = (
  id: string,
  hooks: Partial<ExecuteContext>,
  node: Node = WORKER,
  limits?: Workflow["limits"],
): ExecuteContext => {
  const workflow: Workflow = {
    schemaVersion: 1,
    name: "t",
    nodes: { [id]: node },
    ...(limits === undefined ? {} : { limits }),
  };
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-reserves-"));
  return {
    runId: "r1",
    id,
    node,
    workflow,
    inputs: {},
    outputs: {},
    input: undefined,
    round: 1,
    cwd,
    runDir: path.join(cwd, ".ork/runs/r1"),
    workflowDir: cwd,
    projectRoot: cwd,
    budgetLeftUsd: undefined,
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: true }),
    },
    emit: () => {},
    signal: new AbortController().signal,
    ...hooks,
  };
};

/** Lets queued callbacks run. */
const tick = () =>
  new Promise<void>(resolve => {
    setImmediate(resolve);
  });

describe("nodes running at the same time under a run's budget", () => {
  it("never offers two sessions the same dollars, and one offered less than its cap waits", async () => {
    const book = budgetBook(5);
    const { runtime, specs, finish } = heldRuntime();
    const execute = claudeExecutor({
      runtimeFor: () => Promise.resolve(runtime),
      readyDriver: "claude-code",
      inPlace: true,
    });
    const runs = ["a", "b", "c"].map(id =>
      execute(contextFor(id, book.hooks(id))),
    );
    await tick();
    // a takes its own cap; b and c are offered 2 of their 3 and wait for a.
    expect(specs.map(s => s.budgetUsd)).toEqual([3]);

    finish();
    await tick();
    // a spent 0.5 of its 3 and let the rest go: b gets its 3, c waits for b.
    expect(specs.map(s => s.budgetUsd)).toEqual([3, 3]);
    expect(book.reserves.get("a")).toBe(0);

    finish();
    await tick();
    // b spent 0.5: c gets its 3 of the 4 left.
    expect(specs.map(s => s.budgetUsd)).toEqual([3, 3, 3]);
    finish();
    const results = await Promise.all(runs);
    expect(results.map(r => r.ok)).toEqual([true, true, true]);
    expect([...book.reserves.values()]).toEqual([0, 0, 0]);
  });
});

describe("nodes running at the same time under a run's budgetTokens", () => {
  const capped: Node = {
    type: "agent.worker",
    prompt: "Build",
    budgetTokens: 6,
  };

  it("sets each session's cap aside, and one offered less than its cap waits", async () => {
    const book = tokenBook(10);
    const { runtime, specs, finish } = heldRuntime();
    const execute = claudeExecutor({
      runtimeFor: () => Promise.resolve(runtime),
      readyDriver: "claude-code",
      inPlace: true,
    });
    const runs = ["a", "b", "c"].map(id =>
      execute(contextFor(id, book.hooks(id), capped)),
    );
    await tick();
    // a takes its own cap; b and c are offered 4 of their 6 and wait for a.
    expect(specs.map(s => s.budgetTokens)).toEqual([6]);

    finish();
    await tick();
    // a used 2 of its 6 and let the rest go: b gets its 6, c waits for b.
    expect(specs.map(s => s.budgetTokens)).toEqual([6, 6]);

    finish();
    await tick();
    // b used 2: c gets its 6 of the 6 left.
    expect(specs.map(s => s.budgetTokens)).toEqual([6, 6, 6]);
    finish();
    const results = await Promise.all(runs);
    expect(results.map(r => r.ok)).toEqual([true, true, true]);
    expect([...book.reserves.values()]).toEqual([0, 0, 0]);
  });

  it("refuses a session that doesn't fit, with nothing to wait for", async () => {
    const { runtime, specs } = heldRuntime();
    const execute = claudeExecutor({
      runtimeFor: () => Promise.resolve(runtime),
      readyDriver: "claude-code",
      inPlace: true,
    });
    const result = await execute(
      contextFor("a", tokenBook(0).hooks("a"), capped),
    );
    expect(specs).toEqual([]);
    expect(result).toMatchObject({
      ok: false,
      end: { kind: "budget_limit" },
      output: { summary: `not started: ${NO_TOKENS}` },
    });
  });

  it("refuses the same in dollars", async () => {
    const { runtime, specs } = heldRuntime();
    const result = await claudeExecutor({
      runtimeFor: () => Promise.resolve(runtime),
      readyDriver: "claude-code",
      inPlace: true,
    })(contextFor("a", budgetBook(0).hooks("a")));
    expect(specs).toEqual([]);
    expect(result).toMatchObject({
      ok: false,
      end: { kind: "budget_limit" },
      output: { summary: `not started: ${NO_DOLLARS}` },
    });
  });
});

describe("nodes waiting on a run's budget in dollars and tokens", () => {
  it("hold nothing while they wait, so two that find no tokens never wait on each other", async () => {
    // W0 takes every token; W1 and W2 each find dollars but no tokens.
    const book = bothBook(10, 2);
    const { runtime, specs, finish } = heldRuntime();
    const execute = claudeExecutor({
      runtimeFor: () => Promise.resolve(runtime),
      readyDriver: "claude-code",
      inPlace: true,
    });
    const node: Node = { type: "agent.worker", prompt: "Build", budgetUsd: 1 };
    const runs = ["w0", "w1", "w2"].map(id =>
      execute(contextFor(id, book.hooks(id), node)),
    );
    await tick();
    expect(specs.map(s => [s.budgetUsd, s.budgetTokens])).toEqual([[1, 2]]);
    finish();
    const results = await Promise.all(runs);
    expect(specs).toHaveLength(1);
    expect(results.map(r => r.end?.kind)).toEqual([
      "done",
      "budget_limit",
      "budget_limit",
    ]);
    expect(results[1]?.output).toMatchObject({
      summary: `not started: ${NO_TOKENS}`,
    });
  });

  it("caps a session at what a token quota leaves, and blames the quota when it runs out", async () => {
    const asked: SessionSpec[] = [];
    const execute = claudeExecutor({
      runtimeFor: () => Promise.resolve(usedUp(asked)),
      readyDriver: "claude-code",
      inPlace: true,
    });
    const result = await execute(
      contextFor("a", { quota: () => ({ leftTokens: 3 }) }),
    );
    expect(asked.map(spec => spec.budgetTokens)).toEqual([3]);
    expect(result).toMatchObject({
      ok: false,
      end: { kind: "plan_limit" },
      limited: "a session reached what was left of a quota",
    });
  });
});

/** Runs node `a` under the run's `limits`, its one session ending at its cap. */
const capped = (
  hooks: Partial<ExecuteContext>,
  node: Node,
  limits: Workflow["limits"],
  used = usage,
) =>
  claudeExecutor({
    runtimeFor: () => Promise.resolve(usedUp([], used)),
    readyDriver: "claude-code",
    inPlace: true,
  })(contextFor("a", hooks, node, limits));

describe("a session that reaches the run's budget", () => {
  const worker: Node = { type: "agent.worker", prompt: "Build" };

  it("stops the run budget_exhausted in tokens, keeping its own end", async () => {
    const result = await capped(tokenBook(200).hooks("a"), worker, {
      budgetTokens: 200,
    });
    expect(result).toMatchObject({
      ok: false,
      end: { kind: "budget_limit" },
      limited: "the run's budget of 200 tokens is spent",
      stopsAs: "budget_exhausted",
    });
  });

  it("stops the run budget_exhausted in dollars", async () => {
    const result = await capped(budgetBook(2).hooks("a"), worker, {
      budgetUsd: 2,
    });
    expect(result).toMatchObject({
      limited: "the run's budget of $2 is spent",
      stopsAs: "budget_exhausted",
    });
  });

  it("leaves a stop by the node's own, lower cap a failure", async () => {
    const own: Node = { ...worker, budgetTokens: 50, budgetUsd: 1 };
    const tokens = await capped(tokenBook(200).hooks("a"), own, {
      budgetTokens: 200,
    });
    const usd = await capped(budgetBook(2).hooks("a"), own, { budgetUsd: 2 });
    expect([tokens.limited, usd.limited]).toEqual([undefined, undefined]);
    expect(tokens.end?.kind).toBe("budget_limit");
  });

  it("does not blame the run's dollars for a node's own token cap", async () => {
    const result = await capped(
      bothBook(200, 1000).hooks("a"),
      { ...worker, budgetTokens: 50 },
      { budgetUsd: 2 },
      { ...usage, inputTokens: 50 },
    );
    expect([result.limited, result.stopsAs]).toEqual([undefined, undefined]);
    expect(result.end?.kind).toBe("budget_limit");
  });

  it("does not blame the run's tokens for a node's own dollar cap", async () => {
    const result = await capped(
      bothBook(200, 1000).hooks("a"),
      { ...worker, budgetUsd: 0.5 },
      { budgetTokens: 1000 },
    );
    expect([result.limited, result.stopsAs]).toEqual([undefined, undefined]);
    expect(result.end?.kind).toBe("budget_limit");
  });
});

/** A book's hooks for `a`, with its `budgetSpentIn`. */
const spentHooks = (
  book: ReturnType<typeof budgetBook | typeof tokenBook>,
) => ({
  ...book.hooks("a"),
  budgetSpentIn: book.spentIn,
});

describe("a session that reaches a cap others' reserves shrank (ADR-077)", () => {
  const worker: Node = { type: "agent.worker", prompt: "Build" };

  it("is the node's own budget_limit in dollars while the run is not spent", async () => {
    const book = budgetBook(2);
    book.reserve("b", 1.5);
    const result = await capped(spentHooks(book), worker, { budgetUsd: 2 });
    expect(result).toMatchObject({ ok: false, end: { kind: "budget_limit" } });
    expect([result.limited, result.stopsAs]).toEqual([undefined, undefined]);
  });

  it("is the node's own budget_limit in tokens while the run is not spent", async () => {
    const book = tokenBook(200);
    book.reserve("b", 150);
    const result = await capped(spentHooks(book), worker, {
      budgetTokens: 200,
    });
    expect(result).toMatchObject({ ok: false, end: { kind: "budget_limit" } });
    expect([result.limited, result.stopsAs]).toEqual([undefined, undefined]);
  });

  it("still stops the run in dollars once the run is spent", async () => {
    const result = await capped(
      spentHooks(budgetBook(2)),
      worker,
      { budgetUsd: 2 },
      { ...usage, costUsd: 2 },
    );
    expect(result).toMatchObject({
      limited: "the run's budget of $2 is spent",
      stopsAs: "budget_exhausted",
    });
  });

  it("still stops the run in tokens once the run is spent", async () => {
    const result = await capped(
      spentHooks(tokenBook(200)),
      worker,
      { budgetTokens: 200 },
      { ...usage, inputTokens: 199 },
    );
    expect(result).toMatchObject({
      limited: "the run's budget of 200 tokens is spent",
      stopsAs: "budget_exhausted",
    });
  });
});

/** Starts node `a` with `hooks`; its session stays open until `finish`. */
const startHeld = (hooks: Partial<ExecuteContext>, node: Node) => {
  const { runtime, specs, finish } = heldRuntime();
  const done = claudeExecutor({
    runtimeFor: () => Promise.resolve(runtime),
    readyDriver: "claude-code",
    inPlace: true,
  })(contextFor("a", hooks, node));
  return { done, specs, finish };
};

describe("a worker offered less than its own cap", () => {
  const own: Node = { type: "agent.worker", prompt: "Build", budgetUsd: 8 };
  const ownTokens: Node = {
    type: "agent.worker",
    prompt: "Build",
    budgetTokens: 8,
  };

  it("waits for a worker's reserve to free, then starts with its own cap", async () => {
    const book = budgetBook(20);
    book.reserve("w", 15);
    const { done, specs, finish } = startHeld(book.hooks("a"), own);
    await tick();
    expect(specs).toEqual([]);
    book.reserve("w", 0);
    await tick();
    expect(specs.map(s => s.budgetUsd)).toEqual([8]);
    finish();
    expect((await done).ok).toBe(true);
  });

  it("waits the same in tokens", async () => {
    const book = tokenBook(20);
    book.reserve("w", 15);
    const { done, specs, finish } = startHeld(book.hooks("a"), ownTokens);
    await tick();
    expect(specs).toEqual([]);
    book.reserve("w", 0);
    await tick();
    expect(specs.map(s => s.budgetTokens)).toEqual([8]);
    finish();
    expect((await done).ok).toBe(true);
  });

  it("never waits on a leader's reserve: it starts with what is left", async () => {
    const usd = budgetBook(20);
    usd.leaders.add("l");
    usd.reserve("l", 15);
    const tokens = tokenBook(20);
    tokens.leaders.add("l");
    tokens.reserve("l", 15);
    const dollars = startHeld(usd.hooks("a"), own);
    const counted = startHeld(tokens.hooks("a"), ownTokens);
    await tick();
    expect(dollars.specs.map(s => s.budgetUsd)).toEqual([5]);
    expect(counted.specs.map(s => s.budgetTokens)).toEqual([5]);
  });

  it("starts with the true remainder when no reserve is out", async () => {
    const dollars = startHeld(budgetBook(5).hooks("a"), own);
    const counted = startHeld(tokenBook(5).hooks("a"), ownTokens);
    await tick();
    expect(dollars.specs.map(s => s.budgetUsd)).toEqual([5]);
    expect(counted.specs.map(s => s.budgetTokens)).toEqual([5]);
  });

  it("does not apply to a node with no cap of its own", async () => {
    const book = budgetBook(20);
    book.reserve("w", 15);
    const { specs } = startHeld(book.hooks("a"), {
      type: "agent.worker",
      prompt: "Build",
    });
    await tick();
    expect(specs.map(s => s.budgetUsd)).toEqual([5]);
  });

  it("keeps its dollars set aside when a wait for tokens frees nothing", async () => {
    // Only a leader holds tokens: the worker starts with 4 of its 6.
    const book = bothBook(10, 10);
    book.leaders.add("l");
    book.reserve("l", "tokens", 6);
    const node: Node = {
      type: "agent.worker",
      prompt: "Build",
      budgetUsd: 1,
      budgetTokens: 6,
    };
    // What it holds once its budgets are read, before the session sets its cap.
    const held: unknown[] = [];
    const { runtime, specs } = heldRuntime();
    void claudeExecutor({
      runtimeFor: () => {
        held.push({ ...book.reserves.get("a") });
        return Promise.resolve(runtime);
      },
      readyDriver: "claude-code",
      inPlace: true,
    })(contextFor("a", book.hooks("a"), node));
    await tick();
    expect(specs.map(s => [s.budgetUsd, s.budgetTokens])).toEqual([[1, 4]]);
    expect(held).toEqual([{ usd: 1, tokens: 4 }]);
  });
});
