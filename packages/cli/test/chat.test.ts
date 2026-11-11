/**
 * @file Tests for `ork chat`: a message to a node of a live run waits in the
 *   run's bus for the node's session, and a finished node is answered by
 *   resuming its session, recorded with the run.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  answerDecision,
  type EventStore,
  type HumanChannel,
  nodeSession,
  openStore,
  pendingDecisions,
  type RunRecord,
  type SessionPorts,
  type SessionSpec,
  tellLiveRun,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it } from "vitest";

import { resumeChat, runWorkflowFile } from "../src/index.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const WORKFLOW = [
  "schemaVersion: 1",
  "name: ship",
  "nodes:",
  "  approve:",
  "    type: human.gate",
  "    question: Ship it?",
  "    options: [ship, hold]",
  "  ship:",
  "    type: agent.worker",
  "    isolation: shared",
  '    prompt: "Ship it"',
  "edges:",
  "  - from: approve",
  "    to: ship",
  "    when: choice == 'ship'",
  "",
].join("\n");

/** A fanned reviewer whose items run on their own models. */
const REVIEW = [
  "schemaVersion: 1",
  "name: review",
  "defaults: { model: haiku }",
  "nodes:",
  "  review:",
  "    type: agent.worker",
  "    isolation: shared",
  '    prompt: "Review {{item.concern}}"',
  '    model: "{{item.model}}"',
  "    forEach:",
  "      maxParallel: 1",
  "      items:",
  "        - { concern: correctness, model: opus }",
  "        - { concern: tests, model: sonnet }",
  "",
].join("\n");

/** Each session start's node and model, in order. */
const startedModels = (events: ReturnType<EventStore["events"]>) =>
  events.flatMap(({ event }) =>
    event.type === "node.event" && event.event.type === "session.started"
      ? [[event.id, event.event.model]]
      : [],
  );

const fake = () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE }));

/**
 * A terminal that leaves the gate to `ork decide`, so the run waits there, and
 * takes the recommended answer to anything else.
 */
const gateWaits: HumanChannel = {
  ask: ({ question, recommended, signal }) =>
    question === "Ship it?"
      ? new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new Error("withdrawn"));
          });
        })
      : Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

/** A run of the workflow, waiting at its gate. */
const start = () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-chat-")));
  writeFileSync(path.join(dir, "ship.ork.yaml"), WORKFLOW);
  const home = mkdtempSync(path.join(tmpdir(), "ork-home-"));
  const store: EventStore = openStore(":memory:");
  const out: string[] = [];
  const done = runWorkflowFile({
    file: "ship.ork.yaml",
    cwd: dir,
    inputs: [],
    inPlace: true,
    json: false,
    runtime: fake,
    driverChecks: openCodeReady,
    drivers: standInDrivers,
    human: gateWaits,
    store,
    home,
    intervalMs: 60_000,
    out: line => {
      out.push(line);
    },
    err: () => {
      // The run's status is checked instead.
    },
  });
  return { dir, home, store, out, done };
};

const runOf = (store: EventStore): RunRecord => {
  const [run] = store.runs();
  if (run === undefined) throw new Error("no run");
  return run;
};

/** Answers the gate once it is open. */
const ship = async (run: ReturnType<typeof start>) => {
  await expect
    .poll(() => pendingDecisions(run.store, { project: run.dir }).length)
    .toBe(1);
  const [gate] = pendingDecisions(run.store, { project: run.dir });
  await answerDecision(run.store, gate?.id ?? "", "ship", run.home);
};

describe("ork chat", () => {
  it("queues a message for a node of a live run until its session starts", async () => {
    const run = start();
    await expect.poll(() => run.store.runs().length).toBe(1);
    const record = runOf(run.store);
    expect(
      await tellLiveRun(run.store, record, "ship", "use tabs", run.home),
    ).toBe(true);
    await expect
      .poll(() => run.out.join("\n"))
      .toContain("ship    │ you: use tabs (for its next session)");
    await ship(run);
    expect((await run.done).result?.status).toBe("succeeded");
    expect(run.out.join("\n")).toContain("ship    │ Working on: Ship it");
  });

  it("resumes a finished node's session and adds it to the run", async () => {
    const run = start();
    await ship(run);
    await run.done;
    const record = runOf(run.store);
    const out: string[] = [];
    const chat = (node: string) =>
      resumeChat({
        store: run.store,
        run: record,
        node,
        body: "Also add a summary",
        runtime: fake,
        driverChecks: openCodeReady,
        human: gateWaits,
        out: line => {
          out.push(line);
        },
      });
    expect(await chat("ship")).toBeNull();
    expect(out).toContain("  Working on: Also add a summary (resuming fake-1)");
    const events = run.store.events(record.id, 0);
    expect(nodeSession(events, "ship").session).toMatchObject({
      sessionId: "fake-1",
      cwd: run.dir,
      driver: "claude-code",
      running: false,
    });
    expect(events.map(e => e.event.type)).toContain("user.message");
    expect(await chat("approve")).toBe(
      "approve is not a leader or worker; only they have sessions to talk to.",
    );
    expect(await chat("nobody")).toBe(
      `nobody is not a node of run ${record.id}.`,
    );
  });

  it("resumes a node with no model of its own without naming one", async () => {
    const run = start();
    await ship(run);
    await run.done;
    const specs: SessionSpec[] = [];
    const watched = async () => {
      const runtime = await fake();
      return {
        ...runtime,
        start: (spec: SessionSpec, ports: SessionPorts) => {
          specs.push(spec);
          return runtime.start(spec, ports);
        },
      };
    };
    expect(
      await resumeChat({
        store: run.store,
        run: runOf(run.store),
        node: "ship",
        body: "Again",
        runtime: watched,
        driverChecks: openCodeReady,
        human: gateWaits,
        out: () => {},
      }),
    ).toBeNull();
    expect(specs.map(spec => spec.model)).toEqual([undefined]);
  });

  it("resumes an item of a fanned node as the node it is of", async () => {
    const run = start();
    await ship(run);
    await run.done;
    const record = runOf(run.store);
    run.store.append(record.id, {
      type: "node.started",
      id: "ship.2",
      nodeType: "agent.worker",
      round: 1,
    });
    run.store.append(record.id, {
      type: "node.event",
      id: "ship.2",
      event: {
        type: "session.started",
        sessionId: "fake-1",
        model: "sonnet",
        cwd: run.dir,
        driver: "claude-code",
      },
    });
    run.store.append(record.id, {
      type: "node.finished",
      id: "ship.2",
      round: 1,
      ok: true,
      output: {},
    });
    const out: string[] = [];
    expect(
      await resumeChat({
        store: run.store,
        run: record,
        node: "ship.2",
        body: "Again",
        runtime: fake,
        driverChecks: openCodeReady,
        human: gateWaits,
        out: line => {
          out.push(line);
        },
      }),
    ).toBeNull();
    expect(out).toContain("  Working on: Again (resuming fake-1)");
  });

  it("resumes each item of a fanned node on the model it ran on", async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-chat-")));
    writeFileSync(path.join(dir, "review.ork.yaml"), REVIEW);
    const store: EventStore = openStore(":memory:");
    const run = await runWorkflowFile({
      file: "review.ork.yaml",
      cwd: dir,
      inputs: [],
      inPlace: true,
      json: false,
      runtime: fake,
      driverChecks: openCodeReady,
      drivers: standInDrivers,
      human: gateWaits,
      store,
      home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
      intervalMs: 60_000,
      out: () => {},
      err: () => {},
    });
    expect(run.result?.status).toBe("succeeded");
    const record = runOf(store);
    const chatTo = (node: string) =>
      resumeChat({
        store,
        run: record,
        node,
        body: "Look again",
        runtime: fake,
        driverChecks: openCodeReady,
        human: gateWaits,
        out: () => {},
      });
    expect(await chatTo("review.0")).toBeNull();
    expect(await chatTo("review.1")).toBeNull();
    expect(startedModels(store.events(record.id, 0))).toEqual([
      ["review.0", "opus"],
      ["review.1", "sonnet"],
      ["review.0", "opus"],
      ["review.1", "sonnet"],
    ]);
  });
});
