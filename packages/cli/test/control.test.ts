/**
 * @file Tests for reaching a live run from another terminal: a run with no
 *   terminal (as `--detach` starts it) waits for `ork decide`, an answer for a
 *   closed decision is refused, `ork stop` stops the run, and `ork pause` holds
 *   it, its gate's timeout included, until `ork continue`. A run of one node
 *   refuses `ork pause`, `ork continue` and `ork stop --node`.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  answerDecision,
  type EventStore,
  openStore,
  pendingDecisions,
  requestContinue,
  requestPause,
  runStatus,
  socketPath,
  storePath,
  wakeRun,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime-claude";
import { describe, expect, it } from "vitest";

import { formatDecisions, runWorkflowFile } from "../src/index.ts";
import { sdkReady } from "./fixtures/drivers.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime-claude/test/fixtures/fake-claude.mjs",
);

const GATED = [
  "schemaVersion: 1",
  "name: gated",
  "nodes:",
  "  approve:",
  "    type: human.gate",
  "    question: Ship it?",
  "    options: [ship, hold]",
  "    recommended: hold",
  "  ship:",
  "    type: tool.shell",
  '    command: "echo shipped"',
  "edges:",
  "  - from: approve",
  "    to: ship",
  "    when: choice == 'ship'",
  "",
].join("\n");

/** The gated workflow, answered `ship` by itself after a second. */
const TIMED = GATED.replace(
  "    recommended: hold\n",
  "    recommended: hold\n    timeout: 1s\n    default: ship\n",
);

/** The gated workflow, telling the next node what was said with the answer. */
const NOTED = GATED.replace(
  '"echo shipped"',
  '"echo {{nodes.approve.output.note}}"',
);

type Tools = NonNullable<Parameters<typeof runWorkflowFile>[0]["tools"]>;

const quietTools: Tools = () =>
  Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });

/** A run of the gated workflow with no terminal, and its store. */
const detachedRun = (workflow = GATED, tools = quietTools) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-ctl-")));
  writeFileSync(path.join(dir, "gated.ork.yaml"), workflow);
  const home = mkdtempSync(path.join(tmpdir(), "ork-home-"));
  const store: EventStore = openStore(":memory:");
  const out: string[] = [];
  const done = runWorkflowFile({
    file: "gated.ork.yaml",
    cwd: dir,
    inputs: [],
    inPlace: true,
    json: false,
    runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
    driverChecks: sdkReady,
    store,
    home,
    intervalMs: 60_000,
    out: line => {
      out.push(line);
    },
    err: () => {
      // Errors would fail the run; its status is checked instead.
    },
    tools,
    installed: () => true,
  });
  return { dir, home, store, out, done };
};

/** The run's one open decision, once it is open. */
const opened = async (run: ReturnType<typeof detachedRun>) => {
  await expect
    .poll(() => pendingDecisions(run.store, { project: run.dir }).length)
    .toBe(1);
  const [decision] = pendingDecisions(run.store, { project: run.dir });
  if (decision === undefined) throw new Error("no decision");
  return decision;
};

/** The run's record. */
const recordOf = (store: EventStore, id: string) => {
  const [record] = store.lookup(id);
  if (record === undefined) throw new Error(`no run ${id}`);
  return record;
};

describe("a run with no terminal", () => {
  it("waits for `ork decide`, and goes on with its answer", async () => {
    const run = detachedRun();
    const decision = await opened(run);
    expect(decision).toMatchObject({ node: "approve", question: "Ship it?" });
    expect(formatDecisions([decision])[0]).toContain("hold*");
    expect(
      await answerDecision(run.store, decision.id, "maybe", run.home),
    ).toEqual({
      ok: false,
      error:
        "`maybe` is not an option of `" + decision.id + "`: `ship`, `hold`",
    });
    expect(
      await answerDecision(run.store, decision.id, "ship", run.home),
    ).toEqual({
      ok: true,
      woke: true,
    });
    const { result } = await run.done;
    expect(result?.status).toBe("succeeded");
    expect(result?.nodes.map(n => `${n.id} ${String(n.runs)}`)).toEqual([
      "approve 1",
      "ship 1",
    ]);
    expect(run.out.join("\n")).toContain("→ ship (ork decide)");
    expect(
      await answerDecision(run.store, decision.id, "hold", run.home),
    ).toMatchObject({ ok: false });
  });

  it("hands the note given with `ork decide`'s answer to a later node", async () => {
    const said: string[][] = [];
    const run = detachedRun(NOTED, (program, args, options) => {
      said.push([program, ...args]);
      return quietTools(program, args, options);
    });
    const decision = await opened(run);
    expect(
      await answerDecision(
        run.store,
        decision.id,
        "ship",
        run.home,
        "decide",
        "Tag it v2",
      ),
    ).toEqual({ ok: true, woke: true });
    const { result } = await run.done;
    expect(result?.status).toBe("succeeded");
    expect(said).toEqual([["echo", "Tag it v2"]]);
    expect(run.store.decision(decision.id)?.note).toBe("Tag it v2");
    expect(run.out.join("\n")).toContain(
      "→ ship (ork decide) · said: Tag it v2",
    );
  });

  it("stops when `ork stop` asks it to", async () => {
    const run = detachedRun();
    const decision = await opened(run);
    run.store.command(decision.runId, { kind: "stop" });
    expect(await wakeRun(socketPath(decision.runId, run.home))).toBe(true);
    const { result } = await run.done;
    expect(result?.status).toBe("interrupted");
    expect(run.out.join("\n")).toContain("ork stop received");
    expect(run.store.decision(decision.id)?.status).toBe("withdrawn");
  });

  it("holds while `ork pause` asks it to, its gate's timeout too, until `ork continue`", async () => {
    const run = detachedRun(TIMED);
    const decision = await opened(run);
    const record = recordOf(run.store, decision.runId);
    const status = () =>
      runStatus(
        record,
        run.store.events(record.id).map(stored => stored.event),
      );
    expect(await requestPause(run.store, record, run.home)).toEqual({
      ok: true,
      woke: true,
    });
    await expect.poll(status).toBe("paused");
    await sleep(1500);
    expect(run.store.decision(decision.id)?.status).toBe("open");
    expect(await requestContinue(run.store, record, run.home)).toMatchObject({
      ok: true,
    });
    const { result } = await run.done;
    expect(result?.status).toBe("succeeded");
    expect(run.out.join("\n")).toContain("ork pause received");
    expect(run.out.join("\n")).toContain("ork continue received");
  }, 15_000);
});

/** A live run of one node in its own `~`, held by this process. */
const oneNodeRun = () => {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-home-")));
  const store = openStore(storePath(home));
  const id = "node-1a2b3c4d";
  store.begin({
    id,
    workflow: "review",
    file: "review.ork.yaml",
    project: home,
  });
  store.append(id, {
    type: "run.started",
    runId: id,
    workflow: "review",
    entries: ["approver"],
    nodes: [{ id: "approver", type: "claude.worker" }],
  });
  store.append(id, {
    type: "node.started",
    id: "approver",
    nodeType: "claude.worker",
    round: 1,
  });
  return { home, store, id };
};

/** `ork <args>` for real, with only this `~`. */
const ork = (home: string, ...args: string[]) =>
  spawnSync(process.execPath, [BIN, ...args], {
    cwd: home,
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", HOME: home, NO_COLOR: "1" },
  });

describe("a run of one node", () => {
  it("refuses `ork pause`, `ork continue` and `ork stop --node`, and queues nothing", () => {
    const { home, store, id } = oneNodeRun();
    const refusal = (cannot: string) =>
      `Run ${id} runs one node, which it cannot ${cannot}; stop the whole run instead: ork stop ${id}`;
    const asked = [
      ork(home, "pause", id),
      ork(home, "continue", id, "--node", "approver"),
      ork(home, "stop", id, "--node", "approver"),
    ];
    expect(asked.map(result => result.status)).toEqual([1, 1, 1]);
    expect(asked.map(result => result.stderr.trim())).toEqual([
      refusal("pause or continue"),
      refusal("pause or continue"),
      refusal("stop by name"),
    ]);
    expect(store.takeCommands(id)).toEqual([]);
    store.close();
  }, 30_000);
});
