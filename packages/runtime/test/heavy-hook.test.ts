/**
 * @file Tests for a session's heavy Bash calls (the project's `heavy` rule): on
 *   the stand-in `claude`, a call waits for a machine-wide slot in its pre-call
 *   hook, is deferred past the hold window and resumed once the slot is taken,
 *   and frees it in its post-call hook; the hook itself frees a slot at the
 *   next call and at the session's end; and a session starts below Ork's
 *   priority under `low` only.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { constants, getPriority, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  createHolds,
  fileSlotLedger,
  type MachinePort,
  machinePort,
  type RunEvent,
  type RuntimeEvent,
  type SessionSpec,
  type SlotLedger,
} from "@krapht/ork-core";
import type { Priority } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { createCliRuntime, heavyHook, toolHook } from "../src/index.ts";

const FAKE_CLAUDE = fileURLToPath(
  new URL("fixtures/fake-claude.mjs", import.meta.url),
);

const tmp = (name: string): string =>
  mkdtempSync(path.join(tmpdir(), `ork-heavy-${name}-`));

const specIn = (cwd: string): SessionSpec => ({
  nodeId: "worker",
  cwd,
  model: "haiku",
  prompt: "Check the work",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
});

const human = {
  permit: () => Promise.resolve({ allow: true as const }),
  ask: () => Promise.resolve("a"),
};

const ledgerOf = (slots = 1): SlotLedger =>
  fileSlotLedger({ dir: tmp("slots"), slots, pollMs: 10 });

const portOf = (
  ledger: SlotLedger,
  recorded: RunEvent[],
  priority: Priority = "normal",
): MachinePort => {
  const port = machinePort(
    {
      machine: { rules: { heavy: ["pnpm check"], priority }, ledger },
      onEvent: event => {
        recorded.push(event);
      },
    },
    "r1",
    "worker",
    { waitFor: (_, wait) => wait() },
  );
  if (port === undefined) throw new Error("no machine port");
  return port;
};

/** A run's hold for the node, not paused: the hook is wired. */
const holdOf = () =>
  createHolds({
    onEvent: () => {
      // Not under test.
    },
    onChange: () => {
      // Not under test.
    },
  }).forNode("worker");

const collect = async (events: AsyncIterable<RuntimeEvent>) => {
  const all: RuntimeEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
};

const texts = (events: RuntimeEvent[]): string[] =>
  events.flatMap(e => (e.type === "assistant.text" ? [e.text] : []));

const signal = new AbortController().signal;

const bash = (command: string) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command },
});
const priorityOf = async (priority: Priority): Promise<number> => {
  const file = path.join(tmp("priority"), "nice");
  const session = createCliRuntime({
    bin: FAKE_CLAUDE,
    env: { ...process.env, FAKE_CLAUDE_PRIORITY_FILE: file },
  }).start(specIn(tmp("cwd")), {
    human,
    machine: portOf(ledgerOf(), [], priority),
  });
  await collect(session.events);
  return Number(readFileSync(file, "utf8"));
};

/**
 * A `low` child's priority: `PRIORITY_BELOW_NORMAL` below Ork's, held at
 * `nice`'s lowest (20 on macOS, 19 elsewhere) when Ork already runs low.
 */
const lowered = (own: number): number =>
  Math.min(
    own + constants.priority.PRIORITY_BELOW_NORMAL,
    process.platform === "darwin" ? 20 : 19,
  );

describe("a session's heavy Bash call", () => {
  it("waits for a slot past the window, resumes once it is taken, and frees it after", async () => {
    const ledger = ledgerOf(1);
    const other = await ledger.take(
      { run: "r0", node: "check", pid: process.pid },
      { signal },
    );
    const recorded: RunEvent[] = [];
    const session = createCliRuntime({
      bin: FAKE_CLAUDE,
      holdWindowMs: 30,
      env: { ...process.env, FAKE_CLAUDE_BASH: "pnpm check" },
    }).start(specIn(tmp("cwd")), {
      human,
      hold: holdOf(),
      machine: portOf(ledger, recorded),
    });
    const freeLater = (async () => {
      while (!recorded.some(e => e.type === "slot.waiting")) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- polling a fake
        await sleep(10);
      }
      await sleep(80);
      other?.();
    })();
    const events = await collect(session.events);
    await freeLater;
    expect(recorded).toEqual([
      { type: "slot.waiting", id: "worker", holders: ["r0/check"] },
      { type: "slot.taken", id: "worker" },
    ]);
    expect(texts(events)).toEqual([
      "Working on: Check the work",
      "Working on: the deferred call (resuming fake-1)",
    ]);
    expect(events.filter(e => e.type === "session.finished")).toHaveLength(1);
    expect(ledger.holders()).toEqual([]);
  });
});

describe("the heavy hook", () => {
  it("frees the slot at the session's next call, and at its end", async () => {
    const ledger = ledgerOf(1);
    const hook = heavyHook(portOf(ledger, []));
    expect(await hook.before(bash("pnpm check"), signal, 1000)).toBe("go");
    expect(ledger.holders().map(h => h.node)).toEqual(["worker"]);
    expect(await hook.before(bash("ls"), signal, 1000)).toBe("go");
    expect(ledger.holders()).toEqual([]);
    expect(await hook.before(bash("pnpm  check"), signal, 1000)).toBe("go");
    hook.release();
    expect(ledger.holders()).toEqual([]);
  });

  it("frees the slot after the call, and never takes one for other tools", async () => {
    const ledger = ledgerOf(1);
    const hook = heavyHook(portOf(ledger, []));
    const read = { tool_name: "Read", tool_input: { command: "pnpm check" } };
    expect(await hook.before(read, signal, 1000)).toBe("go");
    expect(ledger.holders()).toEqual([]);
    expect(await hook.before(bash("pnpm check"), signal, 1000)).toBe("go");
    hook.after();
    expect(ledger.holders()).toEqual([]);
  });
});

describe("a session's priority", () => {
  it("starts below Ork's under `low`, and as Ork's under `normal`", async () => {
    expect(await priorityOf("low")).toBe(lowered(getPriority()));
    expect(await priorityOf("normal")).toBe(getPriority());
  });
});

describe("ending a session while its heavy call waits", () => {
  it("ends it promptly when the node is stopped during the deferred wait", async () => {
    const ledger = ledgerOf(1);
    await ledger.take(
      { run: "r0", node: "check", pid: process.pid },
      { signal },
    );
    const recorded: RunEvent[] = [];
    const session = createCliRuntime({
      bin: FAKE_CLAUDE,
      holdWindowMs: 30,
      env: { ...process.env, FAKE_CLAUDE_BASH: "pnpm check" },
    }).start(specIn(tmp("cwd")), {
      human,
      hold: holdOf(),
      machine: portOf(ledger, recorded),
    });
    const stopLater = (async () => {
      while (!recorded.some(e => e.type === "slot.waiting")) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- polling a fake
        await sleep(10);
      }
      await sleep(200);
      await session.interrupt();
    })();
    const ended = await Promise.race([
      collect(session.events).then(() => "ended"),
      sleep(5000).then(() => "hung"),
    ]);
    await stopLater;
    expect(ended).toBe("ended");
    expect(ledger.holders().map(h => h.node)).toEqual(["check"]);
  });

  it("gives back a slot that came after the deferral but before the resume", async () => {
    const ledger = ledgerOf(1);
    const other = await ledger.take(
      { run: "r0", node: "check", pid: process.pid },
      { signal },
    );
    const hook = heavyHook(portOf(ledger, []));
    expect(await hook.before(bash("pnpm check"), signal, 20)).toBe("defer");
    other?.();
    await sleep(100);
    expect(ledger.holders().map(h => h.node)).toEqual(["worker"]);
    hook.release();
    await sleep(20);
    expect(ledger.holders()).toEqual([]);
  });
});

describe("the call's slot without a post-call hook", () => {
  it("is freed at the session's end", async () => {
    const ledger = ledgerOf(1);
    const session = createCliRuntime({
      bin: FAKE_CLAUDE,
      env: {
        ...process.env,
        FAKE_CLAUDE_BASH: "pnpm check",
        FAKE_CLAUDE_NO_POST: "1",
      },
    }).start(specIn(tmp("cwd")), {
      human,
      hold: holdOf(),
      machine: portOf(ledger, []),
    });
    await collect(session.events);
    expect(ledger.holders()).toEqual([]);
  });

  it("is freed by the post-call hook, which takes none", async () => {
    const ledger = ledgerOf(1);
    const handler = toolHook({
      hold: holdOf(),
      heavy: heavyHook(portOf(ledger, [])),
      answer: answer => ({ answer }),
      windowMs: 1000,
      ended: signal,
      onDefer: () => {
        // Not under test.
      },
    });
    expect(await handler(signal, bash("pnpm check"))).toEqual({
      answer: "go",
    });
    expect(ledger.holders().map(h => h.node)).toEqual(["worker"]);
    const after = { ...bash("pnpm check"), hook_event_name: "PostToolUse" };
    expect(await handler(signal, after)).toEqual({});
    expect(ledger.holders()).toEqual([]);
  });
});
