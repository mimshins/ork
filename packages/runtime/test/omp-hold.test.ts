/**
 * @file Holding an `omp` session's calls (RFC-026, ADR-041), on the fake `omp`:
 *   the guard holds a paused node's next call, Ork's own tools included, and
 *   lets it run in the same leg once the node continues; a call the node's
 *   rules refuse never reaches the hold endpoint; a pause past the window
 *   refuses the call and ends the leg with an `abort`, and the node's continue
 *   resumes it (`--resume`) with one message to make the call again, usage
 *   combined; a stop while deferred ends it interrupted; a hold that cannot be
 *   asked refuses the call; a stop while a call is held ends the session with
 *   the call not run; a `heavy` command waits for its slot and frees it once it
 *   has run, while the session goes on; a session with no hold port asks
 *   nothing; and Ork's tools reach the session as host tools (`ork_ask_user`
 *   and `ork_report` answered, the report read, a refused `set_host_tools`
 *   failing the leg, the endpoint `hold.json` names listing no tools, a call
 *   pending at a stop never answered).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  createHolds,
  fileSlotLedger,
  type MachinePort,
  machinePort,
  type RunEvent,
  type RuntimeEvent,
  type SlotLedger,
} from "@krapht/ork-core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { CliAdapter } from "../src/adapter.ts";
import { OMP_PAUSED } from "../src/index.ts";
import { collect, outcomeOf } from "./contract/harness.ts";
import {
  played,
  tampered,
  temp,
  unfenced,
  valueOf,
} from "./fixtures/omp-session.ts";

/** The session id the events started with. */
const sessionIdOf = (events: readonly RuntimeEvent[]): string =>
  events.flatMap(e => (e.type === "session.started" ? [e.sessionId] : []))[0] ??
  "";

/** The arguments of a session's leg `at`; none when there is no such leg. */
const argsAt = (legs: readonly { args: string[] }[], at: number): string[] =>
  legs[at]?.args ?? [];

const NODE = "om";

const quiet = () => {
  // Not under test.
};

/** A run's holds for the node, paused or not, and what they recorded. */
const holdsOf = (paused: boolean) => {
  const recorded: RunEvent[] = [];
  const holds = createHolds({
    onEvent: event => {
      recorded.push(event);
    },
    onChange: quiet,
  });
  if (paused) holds.pause();
  return { holds, recorded, hold: holds.forNode(NODE) };
};

/** Waits until `recorded` has an event of `type`. */
const until = async (recorded: RunEvent[], type: RunEvent["type"]) => {
  while (!recorded.some(event => event.type === type)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling a fake
    await sleep(10);
  }
};

/**
 * Collects a session's events; once the node is held (and `ms` later), notes
 * the events seen so far and does `act`.
 */
const whileHeld = async (
  events: AsyncIterable<RuntimeEvent>,
  recorded: RunEvent[],
  act: () => Promise<void> | void,
  ms = 80,
) => {
  const all: RuntimeEvent[] = [];
  let seen: RuntimeEvent[] = [];
  const watch = (async () => {
    await until(recorded, "node.held");
    await sleep(ms);
    seen = [...all];
    await act();
  })();
  for await (const event of events) all.push(event);
  await watch;
  return { all, seen };
};

const typesOf = (events: readonly RuntimeEvent[]): string[] =>
  events.map(event => event.type);

/** A session's end, or "hung" when it takes longer than five seconds. */
const endedIn = (events: Promise<RuntimeEvent[]>) =>
  Promise.race([events, sleep(5000).then(() => "hung" as const)]);

const SHELL = { tools: { allow: ["Bash"], deny: [] } };

/** One request with a `bash` call of `command`, then the session's end. */
const shell = (command: string) => [
  { calls: [{ tool: "bash", input: { command } }] },
];

describe("an omp session's paused node", () => {
  it("holds the next call, an Ork tool's too, and runs it in the same leg once the node continues", async () => {
    const { holds, recorded, hold } = holdsOf(true);
    const { session, legs, calls } = played({ ports: { hold } });
    const { all, seen } = await whileHeld(session.events, recorded, () => {
      holds.proceed();
    });
    expect(recorded).toContainEqual({
      type: "node.held",
      id: NODE,
      at: "tool",
    });
    expect(typesOf(seen)).not.toContain("tool.called");
    expect(calls("ran").map(call => call.tool)).toEqual([
      "ork_ask_user",
      "ork_report",
    ]);
    expect(legs()).toHaveLength(1);
    expect(
      typesOf(all).filter(type => type === "session.started"),
    ).toHaveLength(1);
    expect(outcomeOf(all).report?.status).toBe("pass");
  });

  it("refuses a call the node's rules refuse at once, without asking the hold endpoint", async () => {
    const { recorded, hold } = holdsOf(true);
    const { session, calls } = played({
      ports: { hold },
      over: { tools: { allow: ["Bash(git status)"], deny: [] } },
      script: shell("rm x"),
    });
    expect(await endedIn(collect(session))).not.toBe("hung");
    expect(recorded.filter(event => event.type === "node.held")).toEqual([]);
    expect(calls("refused").map(call => call.reason)).toEqual([
      expect.stringContaining("bash"),
    ]);
    expect(calls("ran")).toEqual([]);
  });

  it("ends the leg at a pause past the window, and resumes it once the node continues", async () => {
    const { holds, recorded, hold } = holdsOf(true);
    const { session, legs, calls, frames } = played({
      ports: { hold },
      holdWindowMs: 30,
    });
    const { all } = await whileHeld(
      session.events,
      recorded,
      () => {
        holds.proceed();
      },
      300,
    );
    expect(calls("refused").map(call => call.reason)).toEqual([OMP_PAUSED]);
    // The first leg ends with an abort; the second resumes it, asking once,
    // with Ork's tools offered again, and answers its two host tool calls.
    expect(frames()).toEqual([
      "get_state",
      "set_host_tools",
      "prompt",
      "abort",
      "get_state",
      "set_host_tools",
      "prompt",
      "host_tool_result",
      "host_tool_result",
    ]);
    expect(
      calls("frame").findLast(call => call.frame?.type === "prompt")?.frame
        ?.message,
    ).toMatch(/make the same call again/u);
    expect(valueOf(argsAt(legs(), 1), "--resume")).toBe(sessionIdOf(all));
    expect([argsAt(legs(), 0).includes("--resume"), argsAt(legs(), 1)]).toEqual(
      [false, expect.arrayContaining(["--mode", "rpc", "--session-dir"])],
    );
    expect(calls("ran").map(call => call.tool)).toEqual([
      "ork_ask_user",
      "ork_report",
    ]);
    const outcome = outcomeOf(all);
    expect(outcome.report?.status).toBe("pass");
    // Both legs' requests: the paused one, then ask_user and report again.
    expect(outcome.usage.turns).toBe(3);
  });

  it("ends a deferred session interrupted on a stop, never resuming it", async () => {
    const { recorded, hold } = holdsOf(true);
    const { session, legs, calls, frames } = played({
      ports: { hold },
      holdWindowMs: 30,
    });
    const { all } = await whileHeld(
      session.events,
      recorded,
      async () => {
        // Deferred: the leg was ended with an abort before the stop.
        await vi.waitFor(
          () => {
            expect(frames()).toContain("abort");
          },
          { timeout: 5000 },
        );
        await session.interrupt();
      },
      0,
    );
    expect(legs()).toHaveLength(1);
    expect(calls("ran")).toEqual([]);
    expect(outcomeOf(all).end?.kind).toBe("interrupted");
  });

  it("does not run a held call once the session is stopped, and ends interrupted", async () => {
    const { recorded, hold } = holdsOf(true);
    // A fake that plays on past the SIGINT: only the stopped marker keeps the
    // held call from running.
    const { session, calls } = played({
      ports: { hold },
      env: { FAKE_OMP_IGNORE_SIGINT: "1" },
    });
    const { all } = await whileHeld(session.events, recorded, () =>
      session.interrupt(),
    );
    expect(calls("ran")).toEqual([]);
    expect(calls("refused").map(call => call.reason)).toContainEqual(
      expect.stringContaining("Ork stopped this node"),
    );
    expect(outcomeOf(all).end?.kind).toBe("interrupted");
  });
});

const HoldFileSchema = z.object({ url: z.string(), token: z.string() });

/** Rewrites the session's hold file with `change`. */
const holdFile = (change: (held: { url: string; token: string }) => object) =>
  tampered(dir => {
    const file = path.join(dir, "hold.json");
    const held = HoldFileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    writeFileSync(file, JSON.stringify(change(held)));
  });

describe("an omp hold that cannot be asked", () => {
  it.each<[string, (adapter: CliAdapter) => CliAdapter]>([
    [
      "the endpoint not answering",
      holdFile(held => ({ ...held, url: "http://127.0.0.1:1/hold" })),
    ],
    [
      "the endpoint answering 401",
      holdFile(held => ({ ...held, token: "wrong" })),
    ],
    [
      "an answer the guard does not know",
      adapter => ({
        ...adapter,
        hold: { answer: () => ({ what: "?" }), windowMs: 1000 },
      }),
    ],
  ])("refuses the call on %s", async (_case, adapt) => {
    const { session, calls } = played({
      ports: { hold: holdsOf(false).hold },
      over: SHELL,
      script: shell("ls"),
      adapt,
    });
    await collect(session);
    expect(calls("ran")).toEqual([]);
    expect(calls("refused").map(call => call.reason)).toEqual([
      expect.stringContaining("Ork could not be asked"),
    ]);
  });

  it("is never asked by a session with no hold port", async () => {
    const seen: [string | undefined, boolean][] = [];
    const { session, calls } = played({
      over: SHELL,
      script: shell("ls"),
      adapt: tampered((dir, endpoint) => {
        seen.push([endpoint.holdUrl, existsSync(path.join(dir, "hold.json"))]);
      }),
    });
    await collect(session);
    expect(seen).toEqual([[undefined, false]]);
    expect(calls("ran")).toHaveLength(1);
  });
});

const ledgerOf = (): SlotLedger =>
  fileSlotLedger({
    dir: temp("ork-omp-slots-"),
    slots: 1,
    pollMs: 10,
  });

/** The node's machine port; `onTaken` runs as its slot is taken. */
const portOf = (
  ledger: SlotLedger,
  recorded: RunEvent[],
  onTaken = quiet,
): MachinePort => {
  const port = machinePort(
    {
      machine: { rules: { heavy: ["echo heavy"], priority: "normal" }, ledger },
      onEvent: event => {
        recorded.push(event);
        if (event.type === "slot.taken") onTaken();
      },
    },
    "r1",
    NODE,
    { waitFor: (_, wait) => wait() },
  );
  if (port === undefined) throw new Error("no machine port");
  return port;
};

describe("an omp session's heavy call", () => {
  it("waits for its slot, runs once it is taken, and frees it after the call, while the session goes on", async () => {
    const ledger = ledgerOf();
    const other = await ledger.take(
      { run: "r0", node: "check", pid: process.pid },
      { signal: new AbortController().signal },
    );
    const recorded: RunEvent[] = [];
    // Paused as the slot is taken: the heavy call goes on, the next is held.
    const held = holdsOf(false);
    const { session, calls } = played({
      ports: {
        hold: held.hold,
        machine: portOf(ledger, recorded, () => {
          held.holds.pause();
        }),
      },
      over: SHELL,
      script: [
        { calls: [{ tool: "bash", input: { command: "echo heavy" } }] },
        { calls: [{ tool: "bash", input: { command: "ls" } }] },
      ],
    });
    const freeLater = (async () => {
      await until(recorded, "slot.waiting");
      await sleep(80);
      expect(calls("ran")).toEqual([]);
      other?.();
    })();
    let holders: unknown = "not seen";
    let ran: unknown = "not seen";
    await whileHeld(session.events, held.recorded, () => {
      holders = ledger.holders();
      ran = calls("ran").map(call => call.input);
      held.holds.proceed();
    });
    await freeLater;
    expect(ran).toEqual([{ command: "echo heavy" }]);
    expect(holders).toEqual([]);
    expect(recorded).toEqual([
      { type: "slot.waiting", id: NODE, holders: ["r0/check"] },
      { type: "slot.taken", id: NODE },
    ]);
    expect(calls("ran")).toHaveLength(2);
    expect(ledger.holders()).toEqual([]);
  });
});

const ListSchema = z.object({
  result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
});

/** The tools Ork's endpoint lists to the bearer of `hold.json`'s token. */
const listedWith = async (holdJson: string): Promise<string[]> => {
  const held = HoldFileSchema.parse(JSON.parse(readFileSync(holdJson, "utf8")));
  const reply = await fetch(new URL("/mcp", held.url), {
    method: "POST",
    headers: {
      authorization: `Bearer ${held.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  return ListSchema.parse(await reply.json()).result.tools.map(
    tool => tool.name,
  );
};

/** The names of the tools a session's events say were called, in order. */
const calledNames = (events: readonly RuntimeEvent[]): string[] =>
  events.flatMap(e => (e.type === "tool.called" ? [e.name] : []));

/** A session's end kind, or "hung" when {@link endedIn} gave up. */
const endKindOf = (ended: RuntimeEvent[] | "hung") =>
  ended === "hung" ? ended : outcomeOf(ended).end?.kind;

describe("an omp session's host tools", () => {
  it("offers Ork's tools before the prompt, answers ork_ask_user and ork_report, and the run reads the report", async () => {
    const asked: string[] = [];
    const { session, calls, frames } = played({
      ask: ({ question }) => {
        asked.push(question);
        return Promise.resolve("a");
      },
    });
    const all = await collect(session);
    expect(frames()).toEqual([
      "get_state",
      "set_host_tools",
      "prompt",
      "host_tool_result",
      "host_tool_result",
    ]);
    const offered = calls("frame").find(
      call => call.frame?.type === "set_host_tools",
    )?.frame?.["tools"];
    expect(offered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "ork_ask_user" }),
        expect.objectContaining({ name: "ork_report" }),
      ]),
    );
    expect(asked).toEqual(["Which way?"]);
    expect(calls("ran").map(call => call.tool)).toEqual([
      "ork_ask_user",
      "ork_report",
    ]);
    expect(calledNames(all)).toEqual([
      "mcp__ork__ask_user",
      "mcp__ork__report",
    ]);
    expect(outcomeOf(all).report?.status).toBe("pass");
  });

  it("ends the leg failed when omp refuses set_host_tools", async () => {
    const { session, frames } = played({
      env: { FAKE_OMP_HOST_TOOLS: "refuse" },
    });
    const outcome = outcomeOf(await collect(session));
    expect(outcome.report).toBeNull();
    expect(outcome.errors).toEqual([
      expect.stringContaining(
        "omp refused the session's start: host tools are not supported",
      ),
    ]);
    expect(frames()).not.toContain("host_tool_result");
  });

  it("gives hold.json the token of an endpoint that answers the hold and lists no tools", async () => {
    let dir = "";
    const { holds, recorded, hold } = holdsOf(true);
    const { session, calls } = played({
      ports: { hold },
      adapt: tampered(at => {
        dir = at;
      }),
    });
    let listed: string[] = ["not seen"];
    const { all } = await whileHeld(session.events, recorded, async () => {
      listed = await listedWith(path.join(dir, "hold.json"));
      holds.proceed();
    });
    expect(listed).toEqual([]);
    expect(calls("ran").map(call => call.tool)).toEqual([
      "ork_ask_user",
      "ork_report",
    ]);
    expect(outcomeOf(all).report?.status).toBe("pass");
  });

  it("drops the answer of a host call still pending when the session is stopped", async () => {
    let answer: (choice: string) => void = quiet;
    const { session, calls, frames } = played({
      ask: () =>
        new Promise(resolve => {
          answer = resolve;
        }),
    });
    const events = collect(session);
    await vi.waitFor(
      () => {
        expect(calls("ran").map(call => call.tool)).toEqual(["ork_ask_user"]);
      },
      { timeout: 5000 },
    );
    await session.interrupt();
    const ended = await endedIn(events);
    answer("a");
    await sleep(50);
    expect(endKindOf(ended)).toBe("interrupted");
    expect(frames()).not.toContain("host_tool_result");
  });
});

// Last: the tests above run in order, so every session has ended.
describe("every leg of this file's sessions", () => {
  it("ran with the guard and the overlay", () => {
    expect(unfenced()).toEqual([]);
  });
});
