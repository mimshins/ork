/**
 * @file Tests for the machine-wide slots of heavy commands: the file ledger
 *   (slots first come, a dead holder's slot taken over), the slot count from
 *   `ORK_HEAVY_SLOTS`, the `heavy` patterns, a node's machine port and its
 *   events, and how a wait shows in `ork tree`, `ork ps` and the UI.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import {
  activeTree,
  fileSlotLedger,
  type HeldSlot,
  heavySlots,
  isHeavy,
  machinePort,
  matchesPattern,
  type RunEvent,
  slotWaitsOf,
} from "../src/index.ts";

const ledgerIn = (slots = 2) => {
  const dir = mkdtempSync(path.join(tmpdir(), "ork-slots-"));
  return { dir, ledger: fileSlotLedger({ dir, slots, pollMs: 10 }) };
};

const holder = (node: string) => ({ run: "r1", node, pid: process.pid });

const signal = new AbortController().signal;

/** A process that has already ended. */
const deadPid = (): number => {
  const { pid } = spawnSync(process.execPath, ["-e", ""]);
  if (pid === undefined) throw new Error("no pid");
  return pid;
};

describe("the slot ledger", () => {
  it("lets two in, and the third waits until one ends, told who holds them", async () => {
    const { ledger } = ledgerIn();
    const a = await ledger.take(holder("a"), { signal });
    await ledger.take(holder("b"), { signal });
    const told: HeldSlot[][] = [];
    let third = false;
    const waiting = ledger
      .take(holder("c"), {
        signal,
        onWait: held => {
          told.push(held);
        },
      })
      .then(release => {
        third = true;
        return release;
      });
    await sleep(50);
    expect(third).toBe(false);
    expect(told.map(held => held.map(h => h.node))).toEqual([["a", "b"]]);
    a?.();
    await waiting;
    expect(ledger.holders().map(h => h.node)).toEqual(["c", "b"]);
  });

  it("takes over the slot of a holder whose process is gone", async () => {
    const { dir, ledger } = ledgerIn(1);
    mkdirSync(dir, { recursive: true });
    const gone: HeldSlot = { id: "x", run: "r0", node: "n", pid: deadPid() };
    writeFileSync(path.join(dir, "slot-0.json"), JSON.stringify(gone));
    const release = await ledger.take(holder("a"), { signal });
    expect(release).toBeDefined();
    expect(ledger.holders().map(h => h.node)).toEqual(["a"]);
  });

  it("gives up a wait when it is aborted", async () => {
    const { ledger } = ledgerIn(1);
    await ledger.take(holder("a"), { signal });
    const abort = new AbortController();
    const waiting = ledger.take(holder("b"), { signal: abort.signal });
    abort.abort();
    expect(await waiting).toBeNull();
  });

  it("counts ORK_HEAVY_SLOTS, else 2", () => {
    expect(heavySlots({ ORK_HEAVY_SLOTS: "3" })).toBe(3);
    expect(heavySlots({ ORK_HEAVY_SLOTS: "zero" })).toBe(2);
    expect(heavySlots({})).toBe(2);
  });
});

describe("heavy patterns", () => {
  it("match as permission patterns do", () => {
    expect(matchesPattern("vitest run", "vitest run")).toBe(true);
    expect(matchesPattern("vitest run", "vitest run a.test.ts")).toBe(false);
    expect(matchesPattern("pnpm check *", "pnpm check")).toBe(true);
    expect(matchesPattern("pnpm check:*", "pnpm check --x")).toBe(true);
    expect(matchesPattern("pnpm check", "pnpm check:changed")).toBe(false);
    expect(isHeavy(["pnpm test", "npx *vitest run"], "npx  vitest run")).toBe(
      true,
    );
  });
});

describe("a node's machine port", () => {
  it("records the wait with its holders, and the slot it took", async () => {
    const { ledger } = ledgerIn(1);
    const events: RunEvent[] = [];
    const waitedIn: string[] = [];
    const port = (id: string) =>
      machinePort(
        {
          machine: {
            rules: { heavy: ["pnpm check"], priority: "low" },
            ledger,
          },
          onEvent: event => {
            events.push(event);
          },
        },
        "r1",
        id,
        {
          waitFor: (node, wait) => {
            waitedIn.push(node);
            return wait();
          },
        },
      );
    const first = await port("a")?.slot("pnpm check", signal);
    expect(await port("b")?.slot("pnpm lint", signal)).toBeDefined();
    const second = port("b")?.slot("pnpm  check", signal);
    await sleep(50);
    first?.();
    (await second)?.();
    expect(events).toEqual([
      { type: "slot.waiting", id: "b", holders: ["r1/a"] },
      { type: "slot.taken", id: "b" },
    ]);
    expect(waitedIn).toEqual(["a", "b"]);
    expect(port("a")?.priority).toBe("low");
  });

  it("is a wait `ork tree`, `ork ps` and the UI show", () => {
    const at = "2026-11-11T00:00:00.000Z";
    const events: RunEvent[] = [
      {
        type: "run.started",
        runId: "r1",
        workflow: "w",
        entries: ["v"],
        nodes: [{ id: "v", type: "tool.shell" }],
      },
      { type: "node.started", id: "v", nodeType: "tool.shell", round: 1 },
      { type: "slot.waiting", id: "v", holders: ["r0/check"] },
    ];
    const [node] = activeTree(
      events.map((event, seq) => ({ runId: "r1", seq, at, event })),
    );
    expect(node?.now).toBe("waiting for a check slot, held by r0/check");
    expect(slotWaitsOf(events)).toEqual(["v"]);
    expect(slotWaitsOf([...events, { type: "slot.taken", id: "v" }])).toEqual(
      [],
    );
  });
});
