/**
 * @file `omp` sessions on the fake `omp` (RFC-026): a leg fails closed before
 *   any model line without its guard, its overlay or Ork's server; a message
 *   sent mid-leg is delivered by a resumed leg that passes every flag and file
 *   again; a fork carries on under its new id; an unknown session ends with
 *   `omp`'s words; the reading rule (RFC-025) in each mode; the token in no
 *   argument, variable or event; the checkout holds only what the session
 *   wrote; and the usage, cost, context and Ork's ledger of a session.
 */

import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  createHolds,
  type RuntimeEvent,
  type SessionOutcome,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { ompFolders, sessionSpend } from "../src/index.ts";
import { collect, collectActing, outcomeOf } from "./contract/harness.ts";
import {
  flagOf,
  played,
  type Recorded,
  tampered,
  unfenced,
  valueOf,
} from "./fixtures/omp-session.ts";

/** An address where nothing answers. */
const DEAD = "http://127.0.0.1:1/mcp";

/** The arguments of the leg at `at`; none when there is no such leg. */
const argsAt = (legs: readonly Recorded[], at: number): string[] =>
  legs[at]?.args ?? [];

const typesOf = (events: readonly RuntimeEvent[]): string[] =>
  events.map(event => event.type);

const textsOf = (events: readonly RuntimeEvent[]): string[] =>
  events.flatMap(event =>
    event.type === "assistant.text" ? [event.text] : [],
  );

/** The id the session started under. */
const startedId = (events: readonly RuntimeEvent[]): string | undefined =>
  events.flatMap(event =>
    event.type === "session.started" ? [event.sessionId] : [],
  )[0];

const said = (outcome: SessionOutcome): string => JSON.stringify(outcome);

/** A hold port for the node, not paused. */
const holdOf = () =>
  createHolds({
    onEvent: () => {
      // Not under test.
    },
    onChange: () => {
      // Not under test.
    },
  }).forNode("om");

describe("an omp leg fails closed", () => {
  it.each<[string, (dir: string, url: string) => void, string]>([
    [
      "a guard that is missing",
      dir => {
        rmSync(path.join(dir, "guard.mjs"));
      },
      "Trusted extension must be an existing module file",
    ],
    [
      "a guard that throws",
      dir => {
        writeFileSync(path.join(dir, "guard.mjs"), 'throw new Error("boom");');
      },
      "Trusted extension failed to load",
    ],
    [
      "Ork's server not answering",
      (dir, url) => {
        const file = path.join(dir, "plugin", ".mcp.json");
        writeFileSync(file, readFileSync(file, "utf8").replace(url, DEAD));
      },
      "MCP servers not ready",
    ],
    [
      "a missing overlay",
      dir => {
        rmSync(path.join(dir, "overlay.yml"));
      },
      "Config overlay not found",
    ],
  ])("ends before any model line on %s", async (_case, change, words) => {
    const { session, calls } = played({
      adapt: tampered((dir, endpoint) => {
        change(dir, endpoint.url);
      }),
    });
    const events = await collect(session);
    expect(typesOf(events)).toEqual(["session.finished"]);
    const outcome = outcomeOf(events);
    expect(outcome.subtype).not.toBe("success");
    expect(said(outcome)).toContain(words);
    expect(calls("asked")).toEqual([]);
  });

  it("stops the guard's loading when the hold file it expects cannot be read", async () => {
    const { session, calls } = played({
      ports: { hold: holdOf() },
      adapt: tampered(dir => {
        rmSync(path.join(dir, "hold.json"));
      }),
    });
    const events = await collect(session);
    expect(typesOf(events)).toEqual(["session.finished"]);
    expect(said(outcomeOf(events))).toContain(
      "Trusted extension failed to load",
    );
    expect(calls("asked")).toEqual([]);
  });
});

describe("an omp session's private folder", () => {
  it("keeps Ork's token out of every argument, variable and event", async () => {
    const tokens: string[] = [];
    const { session, legs } = played({
      adapt: tampered((_dir, endpoint) => {
        tokens.push(endpoint.token);
      }),
    });
    const events = await collect(session);
    expect(outcomeOf(events).report?.status).toBe("pass");
    const [token = ""] = tokens;
    expect(token).toMatch(/^\S{16,}$/u);
    for (const leg of legs()) {
      expect(leg.args.filter(arg => arg.includes(token))).toEqual([]);
      expect(
        Object.values(leg.env).filter(value => value.includes(token)),
      ).toEqual([]);
    }
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it("leaves in the checkout only what the session's own calls wrote, and refuses a write outside it", async () => {
    const { session, cwd, root, calls } = played({
      over: { tools: { allow: ["Edit"], deny: [] } },
      script: [
        {
          calls: [
            { tool: "write", input: { path: "out.txt", content: "hi" } },
            { tool: "write", input: { path: "../escape.txt", content: "x" } },
          ],
        },
      ],
    });
    await collect(session);
    expect(readdirSync(cwd)).toEqual(["out.txt"]);
    expect(readdirSync(root)).toEqual([]);
    expect(calls("ran").map(call => call.toolCallId)).toEqual(["call_1"]);
    expect(calls("refused").map(call => call.reason)).toEqual([
      expect.stringContaining("outside the worktree"),
    ]);
  });
});

describe("an omp session's usage, cost and context", () => {
  it("adds each request's usage, keeps the last prompt, and counts the dollars in Ork's ledger", async () => {
    const { session, home } = played();
    const outcome = outcomeOf(await collect(session));
    // Ask, report, finish: three requests.
    expect(outcome.usage).toMatchObject({
      inputTokens: 300,
      outputTokens: 60,
      cacheReadTokens: 240,
      cacheWriteTokens: 15,
      turns: 3,
      contextTokens: 185,
    });
    expect(outcome.usage.costUsd).toBeCloseTo(0.003);
    const { spent } = ompFolders(home);
    expect(sessionSpend(spent, outcome.sessionId)).toBeCloseTo(0.003);
    for (const file of readdirSync(spent)) {
      expect(statSync(path.join(spent, file)).mode & 0o777).toBe(0o600);
    }
  });
});

describe("resuming and forking an omp session", () => {
  it("delivers a message sent mid-leg by a resumed leg that passes every flag again", async () => {
    const { session, legs, home } = played({
      scenario: "wait-message",
      over: { budgetUsd: 1 },
    });
    const events = await collectActing(session, () => {
      session.send("Also add tests");
    });
    const outcome = outcomeOf(events);
    // The resumed leg prints only its own messages.
    expect(textsOf(events)).toEqual(["first leg", "got: Also add tests"]);
    expect(valueOf(argsAt(legs(), 1), "--resume")).toBe(outcome.sessionId);
    const FLAGS = [
      "--append-system-prompt",
      "--session-dir",
      "--config",
      "--trusted-extension",
      "--plugin-dir",
      "--max-cost",
    ];
    expect(
      legs().map(leg => FLAGS.map(flag => valueOf(leg.args, flag))),
    ).toEqual([
      [
        "# Ork",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        "1",
      ],
      [
        "# Ork",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        "1",
      ],
    ]);
    // Each leg's usage once; the cost is the session's total.
    expect(outcome.usage).toMatchObject({
      inputTokens: 200,
      turns: 2,
      contextTokens: 185,
    });
    expect(outcome.usage.costUsd).toBeCloseTo(0.002);
    expect(sessionSpend(ompFolders(home).spent, outcome.sessionId)).toBeCloseTo(
      0.002,
    );
  });

  it("forks a session under a new id, its cap and cost counting the source's spend", async () => {
    const source = played();
    const sourceId = outcomeOf(await collect(source.session)).sessionId;
    const fork = played({
      home: source.home,
      over: { resume: sourceId, fork: true, budgetUsd: 1 },
    });
    const events = await collect(fork.session);
    const outcome = outcomeOf(events);
    const args = argsAt(fork.legs(), 0);
    expect(flagOf(args, "--fork")).toBe(sourceId);
    expect(Number(flagOf(args, "--max-cost"))).toBeCloseTo(1.003);
    expect(startedId(events)).not.toBe(sourceId);
    expect(outcome.sessionId).toBe(startedId(events));
    expect(outcome.report?.status).toBe("pass");
    expect(outcome.usage.costUsd).toBeCloseTo(0.006);
  });

  it("resumes a fork without counting the source's spend again", async () => {
    const source = played();
    const sourceId = outcomeOf(await collect(source.session)).sessionId;
    const fork = played({
      home: source.home,
      over: { resume: sourceId, fork: true },
    });
    const forkId = outcomeOf(await collect(fork.session)).sessionId;
    const { spent } = ompFolders(source.home);
    const before = sessionSpend(spent, forkId);
    // The fake prints `parentSession` on this leg's header too.
    const resumed = played({ home: source.home, over: { resume: forkId } });
    const outcome = outcomeOf(await collect(resumed.session));
    const after = sessionSpend(spent, forkId);
    // Each fake request costs 0.001: only this leg's requests are added.
    expect(after - before).toBeCloseTo(outcome.usage.turns * 0.001);
    expect(outcome.usage.costUsd).toBeCloseTo(after);
  });

  it("ends a resume of an unknown session with omp's words", async () => {
    const { session } = played({ over: { resume: "nope" } });
    const outcome = outcomeOf(await collect(session));
    expect(outcome.subtype).not.toBe("success");
    expect(said(outcome)).toContain('Session \\"nope\\" not found');
  });
});

/** Two shell calls, a read of a text file and of an image, in one request. */
const READS = [
  {
    calls: [
      { tool: "bash", input: { command: "cat notes.txt" } },
      { tool: "bash", input: { command: "echo hi | head -1" } },
      { tool: "read", input: { path: "notes.txt" } },
      { tool: "read", input: { path: "shot.png" } },
    ],
  },
];

describe("the reading rule on omp (RFC-025)", () => {
  it.each<["extract" | "extract-only" | "open", string[]]>([
    ["extract", ["call_1"]],
    ["extract-only", ["call_1", "call_3"]],
    ["open", []],
  ])("under reading: %s refuses %j", async (reading, refused) => {
    const { session, cwd, calls, legs } = played({
      over: { reading, tools: { allow: ["Bash"], deny: ["Grep", "Glob"] } },
      script: READS,
    });
    writeFileSync(path.join(cwd, "notes.txt"), "notes");
    writeFileSync(path.join(cwd, "shot.png"), "png");
    await collect(session);
    expect(calls("refused").map(call => call.toolCallId)).toEqual(refused);
    for (const call of calls("refused")) {
      expect(call.reason).toContain("extract");
    }
    expect(calls("ran")).toHaveLength(4 - refused.length);
    // The withheld searches are not offered.
    expect(legs().map(leg => valueOf(leg.args, "--tools"))).toEqual([
      "read,bash",
    ]);
  });
});

// Last: the tests above run in order, so every session has ended.
describe("every leg of this file's sessions", () => {
  it("ran with the guard, the plugin and the overlay", () => {
    expect(unfenced()).toEqual([]);
  });
});
