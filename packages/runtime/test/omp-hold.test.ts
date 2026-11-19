/**
 * @file Holding an `omp` session's calls (RFC-026, ADR-041), on the fake `omp`:
 *   the guard holds a paused node's next call, Ork's own tools included, and
 *   lets it run in the same leg once the node continues; a call the node's
 *   rules refuse never reaches the hold endpoint; a pause past the window
 *   refuses the call with a request to make it again, which waits again, in one
 *   leg; a hold that cannot be asked refuses the call; a stop while a call is
 *   held ends the session with the call not run; a `heavy` command waits for
 *   its slot and frees it; and a session with no hold port asks nothing.
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
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { CliAdapter } from "../src/adapter.ts";
import { OMP_PAUSED } from "../src/index.ts";
import { collect, outcomeOf } from "./contract/harness.ts";
import { played, tampered, temp, unfenced } from "./fixtures/omp-session.ts";

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
      "mcp__ork_session_ork_ask_user",
      "mcp__ork_session_ork_report",
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
      script: shell("ls"),
    });
    expect(await endedIn(collect(session))).not.toBe("hung");
    expect(recorded.filter(event => event.type === "node.held")).toEqual([]);
    expect(calls("refused").map(call => call.reason)).toEqual([
      expect.stringContaining("bash"),
    ]);
    expect(calls("ran")).toEqual([]);
  });

  it("refuses a call held past the window with a request to make it again, which waits again, in one leg", async () => {
    const { holds, recorded, hold } = holdsOf(true);
    const { session, legs, calls } = played({
      ports: { hold },
      holdWindowMs: 30,
    });
    const { all } = await whileHeld(
      session.events,
      recorded,
      () => {
        holds.proceed();
      },
      200,
    );
    const again = calls("refused").filter(call => call.reason === OMP_PAUSED);
    expect(again.length).toBeGreaterThan(0);
    expect(calls("ran").map(call => call.tool)).toEqual([
      "mcp__ork_session_ork_ask_user",
      "mcp__ork_session_ork_report",
    ]);
    expect(legs()).toHaveLength(1);
    expect(outcomeOf(all).report?.status).toBe("pass");
  });

  it("does not run a held call once the session is stopped, and ends interrupted", async () => {
    const { recorded, hold } = holdsOf(true);
    const { session, calls } = played({ ports: { hold } });
    const { all } = await whileHeld(session.events, recorded, () =>
      session.interrupt(),
    );
    // The fake may make its next call before the SIGINT lands; the guard
    // refuses that one too, so no call runs whatever the timing.
    expect(calls("asked").length).toBeGreaterThan(0);
    expect(calls("ran")).toEqual([]);
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

const portOf = (ledger: SlotLedger, recorded: RunEvent[]): MachinePort => {
  const port = machinePort(
    {
      machine: { rules: { heavy: ["echo heavy"], priority: "normal" }, ledger },
      onEvent: event => {
        recorded.push(event);
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
  it("waits for its slot, runs once it is taken, and frees it", async () => {
    const ledger = ledgerOf();
    const other = await ledger.take(
      { run: "r0", node: "check", pid: process.pid },
      { signal: new AbortController().signal },
    );
    const recorded: RunEvent[] = [];
    const { session, calls } = played({
      ports: { hold: holdsOf(false).hold, machine: portOf(ledger, recorded) },
      over: SHELL,
      script: shell("echo heavy"),
    });
    const freeLater = (async () => {
      await until(recorded, "slot.waiting");
      await sleep(80);
      expect(calls("ran")).toEqual([]);
      other?.();
    })();
    await collect(session);
    await freeLater;
    expect(recorded).toEqual([
      { type: "slot.waiting", id: NODE, holders: ["r0/check"] },
      { type: "slot.taken", id: NODE },
    ]);
    expect(calls("ran")).toHaveLength(1);
    expect(ledger.holders()).toEqual([]);
  });
});

// Last: the tests above run in order, so every session has ended.
describe("every leg of this file's sessions", () => {
  it("ran with the guard, the plugin and the overlay", () => {
    expect(unfenced()).toEqual([]);
  });
});
