/**
 * @file The contract every adapter keeps (RFC-014), run against each entry of
 *   `entries.ts` on its fake tool through the shared session runner: events
 *   normalized, a valid report kept and an invalid one rejected, a denied tool
 *   still denied, Ork's endpoint reached and then gone, usage counted, an
 *   interrupt ending the session, a message sent mid-session arriving, and,
 *   where the driver cannot hold the report to its schema, a report handed in
 *   through Ork's `report` tool. The same cause ends as the same kind on every
 *   driver (specs/runtime/session-ends.md), and every driver stops at its token
 *   cap (RFC-015). Every adapter registered in `registry.ts` must have an
 *   entry.
 */

import { tmpdir } from "node:os";
import path from "node:path";

import type { DriverCapabilities } from "@krapht/ork-integrations";
import { describe, expect, it } from "vitest";

import { ADAPTERS } from "../../src/index.ts";
import { CONTRACT, TOOL_ENDS } from "./entries.ts";
import {
  answers,
  collect,
  collectActing,
  outcomeOf,
  resultsOf,
  start,
} from "./harness.ts";

const EVENT_TYPES = new Set([
  "session.started",
  "assistant.text",
  "tool.called",
  "tool.result",
  "plan.limit",
  "session.finished",
]);

/** The drivers with an adapter in the registry. */
const registered = (): string[] =>
  Object.entries(ADAPTERS)
    .filter(([, adapter]) => adapter !== null)
    .map(([driver]) => driver);

/** When a message sent mid-session reaches the tool. */
const when = (capabilities: DriverCapabilities): string =>
  capabilities.midTurnMessages ? "as soon as it can" : "at its next leg";

describe("the contract list", () => {
  it("has an entry for every adapter registered, and no other", () => {
    expect(CONTRACT.map(entry => entry.driver).toSorted()).toEqual(
      registered().toSorted(),
    );
  });

  it("tests the adapter registered under each entry's id", () => {
    expect(CONTRACT.map(entry => ADAPTERS[entry.driver])).toEqual(
      CONTRACT.map(entry => entry.adapter),
    );
  });
});

describe.each(CONTRACT)("the $driver adapter", entry => {
  it("normalizes its output: a start naming the driver, text, an end", async () => {
    const events = await collect(start(entry, "plain").session);
    expect(events[0]).toMatchObject({
      type: "session.started",
      driver: entry.driver,
    });
    expect(events.map(e => e.type)).toContain("assistant.text");
    expect(events.filter(e => !EVENT_TYPES.has(e.type))).toEqual([]);
    expect(outcomeOf(events).sessionId).not.toBe("");
  });

  it("ends with the report it gave when the report fits the schema", async () => {
    const outcome = outcomeOf(await collect(start(entry, "plain").session));
    expect(outcome.subtype).toBe("success");
    expect(outcome.report).toMatchObject({ status: "pass" });
  });

  it("ends with no report when the report breaks the schema", async () => {
    const events = await collect(start(entry, "invalid-report").session);
    expect(outcomeOf(events).report).toBeNull();
  });

  it("keeps a tool the node denies denied", async () => {
    const events = await collect(start(entry, "try-denied").session);
    expect(resultsOf(events, "Bash")).toEqual([true]);
  });

  it("reaches Ork's endpoint during the session, and it is gone after", async () => {
    const started = start(entry, "plain");
    const during: boolean[] = [];
    await collectActing(started.session, async () => {
      during.push(await answers(started.endpoint()));
    });
    expect(during).toEqual([true]);
    expect(await answers(started.endpoint())).toBe(false);
  });

  it("counts its usage: tokens, turns, and dollars when it reports them", async () => {
    const { usage } = outcomeOf(await collect(start(entry, "plain").session));
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.turns).toBeGreaterThan(0);
    expect(usage.costUsd > 0).toBe(entry.capabilities.price);
  });

  it("ends when interrupted", async () => {
    const { session } = start(entry, "hang");
    const outcome = outcomeOf(await collectActing(session, session.interrupt));
    expect(outcome).toMatchObject({
      subtype: "error_driver",
      end: { kind: "interrupted" },
      errors: ["interrupted"],
    });
  });

  it(`takes a message sent mid-session ${when(entry.capabilities)}`, async () => {
    const { session } = start(entry, "wait-message");
    const events = await collectActing(session, () => {
      session.send("Also add tests");
    });
    expect(outcomeOf(events).text).toContain("got: Also add tests");
  });
});

describe.each(CONTRACT.filter(entry => !entry.capabilities.reportSchema))(
  "the $driver adapter, with no report schema of its own",
  entry => {
    it("ends with the report Ork's report tool accepted, after refusing one", async () => {
      const events = await collect(start(entry, "report-tool").session);
      expect(resultsOf(events, "report")).toEqual([true, false]);
      expect(outcomeOf(events).report).toMatchObject({ status: "pass" });
    });
  },
);

describe.each(CONTRACT)("the $driver adapter's ends", entry => {
  it.each(entry.ends)(
    "ends a session the tool says hit %s as that kind",
    async kind => {
      const events = await collect(start(entry, `end:${kind}`).session);
      expect(outcomeOf(events).end?.kind).toBe(kind);
    },
  );

  it("writes the turn limit with the node's number, and keeps the tool's words out of it", async () => {
    const { end } = outcomeOf(
      await collect(start(entry, "end:turn_limit").session),
    );
    expect(end?.message).toBe("reached its turn limit (5)");
  });

  it("keeps a provider's error as the detail, never the message", async () => {
    const { end } = outcomeOf(
      await collect(start(entry, "end:model_unavailable").session),
    );
    expect(end?.detail).toContain("prefill");
    expect(end?.message).not.toContain("prefill");
  });

  it("ends as tool_missing when its program isn't installed", async () => {
    const missing = path.join(
      tmpdir(),
      "ork-no-such-tool",
      entry.adapter.command.bin,
    );
    const { end } = outcomeOf(
      await collect(start(entry, "plain", missing).session),
    );
    expect(end?.kind).toBe("tool_missing");
  });

  it("ends a session that reported as done", async () => {
    const { end } = outcomeOf(await collect(start(entry, "plain").session));
    expect(end).toEqual({ kind: "done", message: "finished" });
  });
});

describe.each(CONTRACT)("the $driver adapter's token cap", entry => {
  // Each fake request uses 100 input, 80 cache-read and about 25 other tokens.
  const capped = (spec: { budgetTokens: number; budgetUsd?: number }) =>
    collect(start(entry, "spend", entry.fakeTool, spec).session).then(
      outcomeOf,
    );

  it("stops the session at the request that reaches it, ending budget_limit", async () => {
    const outcome = await capped({ budgetTokens: 300 });
    expect(outcome.end).toEqual({
      kind: "budget_limit",
      message: "reached its budget (300 tokens)",
    });
    expect(outcome.report).toBeNull();
  });

  it("never counts cache reads: three requests fit where two would not", async () => {
    const { usage } = await capped({ budgetTokens: 300 });
    expect(usage.inputTokens).toBe(300);
    expect(usage.cacheReadTokens).toBe(240);
  });

  it("stops at the token cap with a dollar cap beside it", async () => {
    const { end } = await capped({ budgetTokens: 300, budgetUsd: 100 });
    expect(end?.message).toBe("reached its budget ($100, 300 tokens)");
  });

  it.runIf(entry.ends.includes("budget_limit"))(
    "stops at the dollar cap first when the tool reaches it first",
    async () => {
      const { end } = outcomeOf(
        await collect(
          start(entry, "end:budget_limit", entry.fakeTool, {
            budgetUsd: 0.5,
            budgetTokens: 1_000_000,
          }).session,
        ),
      );
      expect(end?.kind).toBe("budget_limit");
    },
  );
});

describe.each(CONTRACT)("the $driver contract entry", entry => {
  it("plays every cause a tool reports", () => {
    expect(entry.ends).toEqual(expect.arrayContaining([...TOOL_ENDS]));
  });
});
