/**
 * @file Tests for a child's question going to its leader first (`questions:
 *   owner`, ADR-063), end to end against the stand-in `claude`: a fork of the
 *   leader's session answers it, or passes it on to the person with its note,
 *   or fails and the person is asked; and without the setting the person is
 *   asked as before. Each answer is a decision that says who gave it.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  type HumanChannel,
  openStore,
  type RunEvent,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime-claude";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatEvent, runWorkflowFile } from "../src/index.ts";
import { readyOnly } from "./fixtures/drivers.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime-claude/test/fixtures/fake-claude.mjs",
);

/** A leader and the worker it owns, which runs after it in the flow. */
const workflow = (questions: string) =>
  [
    "schemaVersion: 1",
    "name: owned",
    "nodes:",
    "  lead:",
    "    type: claude.leader",
    "    isolation: shared",
    "    prompt: Plan the change",
    ...(questions === "" ? [] : [`    questions: ${questions}`]),
    "  work:",
    "    type: claude.worker",
    "    parent: lead",
    "    isolation: shared",
    "    prompt: Build the change",
    "edges:",
    "  - lead -> work",
    "",
  ].join("\n");

/** Answers each question with its recommended option, and notes what it saw. */
const recommending = () => {
  const asked: { nodeId: string; context?: string; owner?: string }[] = [];
  const human: HumanChannel = {
    ask: ({ nodeId, context, owner, recommended }) => {
      asked.push({
        nodeId,
        ...(context === undefined ? {} : { context }),
        ...(owner === undefined ? {} : { owner }),
      });
      return Promise.resolve(recommended ?? "none");
    },
    permit: () => Promise.resolve({ allow: true }),
  };
  return { human, asked };
};

const run = async (questions: string) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-owner-")));
  writeFileSync(path.join(dir, "owned.ork.yaml"), workflow(questions));
  const store: EventStore = openStore(":memory:");
  const { human, asked } = recommending();
  const done = await runWorkflowFile({
    file: "owned.ork.yaml",
    cwd: dir,
    inputs: [],
    inPlace: true,
    json: false,
    runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
    driverChecks: readyOnly("cli"),
    human,
    store,
    home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
    out: () => {
      // The records are checked instead.
    },
    err: () => {
      // As above.
    },
  });
  const runId = String(done.result?.runId);
  const events = store.events(runId, 0).map(({ event }) => event);
  const decisions = store.decisions({ runId });
  return { done, asked, events, decisions };
};

/** The decision `work` asked, as recorded. */
const workDecision = (
  decisions: Awaited<ReturnType<typeof run>>["decisions"],
) => decisions.find(({ node }) => node === "work");

/** The text `work`'s ask_user call returned. */
const toldWork = (events: readonly RunEvent[]) =>
  events.flatMap(event =>
    event.type === "node.event" &&
    event.id === "work" &&
    event.event.type === "session.finished"
      ? [event.event.outcome.text]
      : [],
  );

/** The fork's session events, recorded under the leader, marked as a fork's. */
const forkEvents = (events: readonly RunEvent[]) =>
  events.flatMap(event =>
    event.type === "node.event" &&
    event.id === "lead" &&
    event.event.fork === true
      ? [event.event.type]
      : [],
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a child's question, with questions: owner", () => {
  it("is answered by a fork of the leader's session, and recorded as the owner's", async () => {
    const { done, asked, events, decisions } = await run("owner");

    expect(done.result?.status).toBe("succeeded");
    expect(asked.map(({ nodeId }) => nodeId)).toEqual(["lead"]);
    expect(workDecision(decisions)).toMatchObject({
      status: "answered",
      answer: "a",
      answeredBy: "owner",
      owner: "lead",
      note: "The spec settles it.",
    });
    expect(toldWork(events)).toEqual([
      "Your owner, `lead`, chose: a\nThey said: The spec settles it.",
    ]);
    // Every event the fork recorded under the leader says it is a fork's.
    expect(forkEvents(events)).toEqual([
      "session.started",
      "assistant.text",
      "session.finished",
    ]);
    // Two sessions at $0.0123 and the fork's $0.002, in the run's spend,
    // the fork's against the leader, so the nodes' costs add up to the run's.
    expect(done.result?.costUsd).toBeCloseTo(0.0266, 6);
    const costs = new Map(done.result?.nodes.map(n => [n.id, n.costUsd]));
    expect(costs.get("lead")).toBeCloseTo(0.0143, 6);
    expect(costs.get("work")).toBeCloseTo(0.0123, 6);
  });

  it("goes to the person with the leader's note when the fork passes it on", async () => {
    vi.stubEnv("FAKE_CLAUDE_FORK_CHOICE", "ask-user");
    const { asked, decisions } = await run("owner");

    expect(asked).toContainEqual({
      nodeId: "work",
      owner: "lead",
      context: "lead passed this on: The spec settles it.",
    });
    expect(workDecision(decisions)).toMatchObject({
      answeredBy: "terminal",
      owner: "lead",
      context: "lead passed this on: The spec settles it.",
    });
  });

  it("goes to the person as before when the fork fails", async () => {
    vi.stubEnv("FAKE_CLAUDE_FORK_FAIL", "1");
    const { done, asked, events, decisions } = await run("owner");

    expect(done.result?.status).toBe("succeeded");
    expect(asked.map(({ nodeId }) => nodeId)).toEqual(["lead", "work"]);
    expect(workDecision(decisions)).toMatchObject({ answeredBy: "terminal" });
    expect(workDecision(decisions)).not.toHaveProperty("owner");
    // Every event the fork recorded under the leader says it is a fork's.
    expect(forkEvents(events)).toEqual([
      "session.started",
      "assistant.text",
      "session.finished",
    ]);
  });
});

describe("a child's question, by default", () => {
  it("goes to the person, and no fork starts", async () => {
    const { asked, events, decisions } = await run("");

    expect(asked.map(({ nodeId }) => nodeId)).toEqual(["lead", "work"]);
    expect(workDecision(decisions)).toMatchObject({ answeredBy: "terminal" });
    expect(workDecision(decisions)).not.toHaveProperty("owner");
    expect(forkEvents(events)).toEqual([]);
    expect(toldWork(events)).toEqual(["The user chose: a"]);
  });
});

describe("the leader's fork in the logs", () => {
  it("says it is a fork, not the leader's own session", () => {
    expect(
      formatEvent(
        "lead",
        {
          type: "session.started",
          sessionId: "fork-1",
          model: "opus",
          fork: true,
        },
        new Map(),
      ).join(""),
    ).toContain("lead (opus, session fork-1, a fork to answer a question)");
  });
});
