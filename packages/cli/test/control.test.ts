/**
 * @file Tests for reaching a live run from another terminal: a run with no
 *   terminal (as `--detach` starts it) waits for `ork decide`, an answer for a
 *   closed decision is refused, and `ork stop` stops the run.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  openStore,
  socketPath,
  wakeRun,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime-claude";
import { describe, expect, it } from "vitest";

import {
  answerDecision,
  formatDecisions,
  pendingDecisions,
  runWorkflowFile,
} from "../src/index.ts";

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

/** A run of the gated workflow with no terminal, and its store. */
const detachedRun = () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-ctl-")));
  writeFileSync(path.join(dir, "gated.ork.yaml"), GATED);
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
    store,
    home,
    intervalMs: 60_000,
    out: line => {
      out.push(line);
    },
    err: () => {
      // Errors would fail the run; its status is checked instead.
    },
    tools: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
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
      error: `"maybe" is not an option of ${decision.id}: ship, hold`,
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

  it("stops when `ork stop` asks it to", async () => {
    const run = detachedRun();
    const decision = await opened(run);
    run.store.command(decision.runId, "stop");
    expect(await wakeRun(socketPath(decision.runId, run.home))).toBe(true);
    const { result } = await run.done;
    expect(result?.status).toBe("interrupted");
    expect(run.out.join("\n")).toContain("ork stop received");
    expect(run.store.decision(decision.id)?.status).toBe("withdrawn");
  });
});
