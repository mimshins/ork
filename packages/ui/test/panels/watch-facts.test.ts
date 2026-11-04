/** @file Tests for what a `watch:` says in the Monitor (RFC-011). */

import { describe, expect, it } from "vitest";

import { stillGoing, watchFacts } from "../../src/panels/watch-facts.ts";

const AT = Date.parse("2026-11-04T10:00:00Z");

const watching = {
  until: "json.result != 'pending'",
  every: "30s",
  timeout: "2h",
  startedAt: "2026-11-04T10:00:00Z",
  looks: 4,
  at: "2026-11-04T10:00:00Z",
  said: '{"result":"pending"}',
  ok: true,
};

describe("watch facts", () => {
  it("gives the recorded count, right after a change", () => {
    const facts = watchFacts(watching, AT + 1000);
    expect(facts.looks).toBe("4");
    expect(facts.next).toBe("in about 29 s");
    expect(facts.until).toBe(watching.until);
    expect(facts.every).toBe("every 30s");
  });

  it("says about, for looks worked out from the time", () => {
    const facts = watchFacts(watching, AT + 95_000);
    expect(facts.looks).toBe("about 7");
    expect(facts.next).toBe("in about 25 s");
  });

  it("gives a long wait in minutes and hours", () => {
    expect(watchFacts({ ...watching, every: "5m" }, AT).next).toBe(
      "in about 5 min",
    );
    expect(watchFacts({ ...watching, every: "2h" }, AT).next).toBe(
      "in about 2 h",
    );
  });
});

describe("whether a run is still waiting", () => {
  it.each(["running", "paused"])("%s is", status => {
    expect(stillGoing(status)).toBe(true);
  });

  it.each(["crashed", "failed", "succeeded"])("%s isn't", status => {
    expect(stillGoing(status)).toBe(false);
  });
});
