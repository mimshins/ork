/**
 * @file Tests for `ork chat`: a message to a node of a live run waits in the
 *   run's bus for the node's session, and a finished node is answered by
 *   resuming its session, recorded with the run.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  type HumanChannel,
  openStore,
  type RunRecord,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime-claude";
import { describe, expect, it } from "vitest";

import {
  answerDecision,
  nodeSession,
  pendingDecisions,
  resumeChat,
  runWorkflowFile,
  tellLiveRun,
} from "../src/index.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime-claude/test/fixtures/fake-claude.mjs",
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
  "    type: claude.worker",
  "    isolation: shared",
  '    prompt: "Ship it"',
  "edges:",
  "  - from: approve",
  "    to: ship",
  "    when: choice == 'ship'",
  "",
].join("\n");

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
      driver: "cli",
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
});
