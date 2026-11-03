/**
 * @file Tests for holding a session before its next tool call (ADR-041): the
 *   CLI driver's `PreToolUse` HTTP hook holds a paused node's call and lets it
 *   run once the node continues; a pause past the hold window defers the call
 *   and resumes the session with no new message, its usage added up; and both
 *   drivers wire the hook only for a node that can be held.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  createHolds,
  type RunEvent,
  type RuntimeEvent,
  type SessionSpec,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import {
  buildCliArgs,
  buildSdkOptions,
  createCliRuntime,
  withHoldHook,
} from "../src/index.ts";

const FAKE_CLAUDE = fileURLToPath(
  new URL("fixtures/fake-claude.mjs", import.meta.url),
);

const specIn = (cwd: string): SessionSpec => ({
  nodeId: "approver",
  cwd,
  model: "haiku",
  prompt: "Review the branch",
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

/** A paused run's holds, and what they recorded. */
const pausedRun = () => {
  const recorded: RunEvent[] = [];
  const holds = createHolds({
    onEvent: event => {
      recorded.push(event);
    },
    onChange: () => {
      // Not under test.
    },
  });
  holds.pause();
  return { holds, recorded, hold: holds.forNode("approver") };
};

/** Collects a session's events, and lets the run continue once asked. */
const run = async (
  events: AsyncIterable<RuntimeEvent>,
  whenHeld: () => void,
  recorded: RunEvent[],
) => {
  const all: RuntimeEvent[] = [];
  const watch = (async () => {
    while (!recorded.some(e => e.type === "node.held")) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- polling a fake
      await sleep(10);
    }
    await sleep(80);
    whenHeld();
  })();
  for await (const event of events) all.push(event);
  await watch;
  return all;
};

/** The text the session said, in order. */
const textsOf = (events: RuntimeEvent[]): string[] =>
  events.flatMap(e => (e.type === "assistant.text" ? [e.text] : []));

const finished = (events: RuntimeEvent[]) => {
  const last = events.at(-1);
  return last?.type === "session.finished" ? last.outcome : null;
};

describe("the CLI driver's hold", () => {
  it("holds a paused node's tool call, and lets it run once the node continues", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ork-hold-cli-"));
    const { holds, recorded, hold } = pausedRun();
    const session = createCliRuntime({ bin: FAKE_CLAUDE }).start(specIn(cwd), {
      human,
      hold,
    });
    const events = await run(
      session.events,
      () => {
        holds.proceed();
      },
      recorded,
    );
    expect(recorded).toContainEqual({
      type: "node.held",
      id: "approver",
      at: "tool",
    });
    expect(events.map(e => e.type)).toEqual([
      "session.started",
      "assistant.text",
      "tool.called",
      "tool.result",
      "session.finished",
    ]);
    expect(finished(events)).toMatchObject({
      subtype: "success",
      report: { status: "pass" },
      usage: { costUsd: 0.0123 },
    });
  });

  it("defers a call held past the window, then resumes the session with no new message", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ork-hold-cli-"));
    const { holds, recorded, hold } = pausedRun();
    const session = createCliRuntime({
      bin: FAKE_CLAUDE,
      holdWindowMs: 30,
    }).start(specIn(cwd), { human, hold });
    const events = await run(
      session.events,
      () => {
        holds.proceed();
      },
      recorded,
    );
    expect(textsOf(events)).toEqual([
      "Working on: Review the branch",
      "Working on: the deferred call (resuming fake-1)",
    ]);
    expect(events.filter(e => e.type === "session.started")).toHaveLength(1);
    expect(events.filter(e => e.type === "session.finished")).toHaveLength(1);
    expect(finished(events)).toMatchObject({
      subtype: "success",
      report: { status: "pass" },
      usage: { turns: 3 },
    });
    // Cost is already the session's total across a resume.
    expect(finished(events)?.usage.costUsd).toBeCloseTo(0.0123);
    expect(recorded.filter(e => e.type === "node.held")).toHaveLength(1);
  });
});

describe("wiring the hold hook", () => {
  const mcp = { url: "http://127.0.0.1:1/mcp", token: "tok" };

  it("adds Ork's PreToolUse HTTP hook to the CLI's settings, after any others", () => {
    expect(
      withHoldHook(
        { skillOverrides: { x: "off" }, hooks: { PreToolUse: ["theirs"] } },
        "http://127.0.0.1:1/hold",
        "tok",
      ),
    ).toEqual({
      skillOverrides: { x: "off" },
      hooks: {
        PreToolUse: [
          "theirs",
          {
            matcher: "*",
            hooks: [
              {
                type: "http",
                url: "http://127.0.0.1:1/hold",
                headers: { Authorization: "Bearer tok" },
                timeout: 600,
              },
            ],
          },
        ],
      },
    });
    const plain = buildCliArgs(specIn("/w"), mcp, []);
    expect(plain).not.toContain("--settings");
    const held = buildCliArgs(
      specIn("/w"),
      { ...mcp, holdUrl: "http://127.0.0.1:1/hold" },
      [],
    );
    expect(held[held.indexOf("--settings") + 1]).toContain("/hold");
  });

  it("gives an SDK session the hook only when its node can be held", () => {
    const { hold } = pausedRun();
    const env = { ANTHROPIC_API_KEY: "test" };
    const without = buildSdkOptions(specIn("/w"), { human }, env);
    expect(without.hooks).toBeUndefined();
    const withHold = buildSdkOptions(specIn("/w"), { human, hold }, env, {
      onDefer: () => {
        // Not under test.
      },
    });
    expect(withHold.hooks?.PreToolUse).toHaveLength(1);
    expect(withHold.hooks?.PreToolUse?.[0]?.timeout).toBe(600);
  });
});
