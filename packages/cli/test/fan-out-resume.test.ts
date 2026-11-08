/**
 * @file A fanned node through the real CLI: `ork run` is killed with SIGKILL
 *   partway through its items, and `ork resume` reruns only the items that did
 *   not finish. Its items are programs, so it needs no Claude account.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type EventStore, openStore, storePath } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");
const FIXTURE = path.resolve(import.meta.dirname, "fixtures/fan-out.ork.yaml");

const setup = () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-fan-")));
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-home-")));
  writeFileSync(path.join(dir, "fan.ork.yaml"), readFileSync(FIXTURE));
  const env = { PATH: process.env["PATH"] ?? "", HOME: home, NO_COLOR: "1" };
  return { dir, home, env };
};

/** Whether the item's result is in the store, so a crash can't lose it. */
const finished = (store: EventStore, runId: string, item: string): boolean =>
  store
    .events(runId)
    .some(({ event }) => event.type === "node.finished" && event.id === item);

const onlyRunId = (store: EventStore): string => store.runs()[0]?.id ?? "";

const marks = (dir: string, index: number): number =>
  readFileSync(path.join(dir, `marks-${String(index)}`), "utf8")
    .trim()
    .split("\n").length;

describe("killing a fan-out and resuming it", () => {
  it("reruns only the unfinished items", async () => {
    const { dir, home, env } = setup();
    const child = spawn(
      process.execPath,
      [BIN, "run", "fan.ork.yaml", "--in-place"],
      { cwd: dir, env, stdio: "ignore" },
    );
    const exited = new Promise(resolve => {
      child.once("exit", resolve);
    });
    await expect
      .poll(
        () => {
          const store = openStore(storePath(home));
          const runId = onlyRunId(store);
          const seen = finished(store, runId, "build.0");
          store.close();
          return seen;
        },
        { timeout: 20_000, interval: 20 },
      )
      .toBe(true);
    child.kill("SIGKILL");
    await exited;

    // Items after the kill must not wait on the one the kill left sleeping.
    writeFileSync(path.join(dir, "go"), "");
    const store = openStore(storePath(home));
    const runId = onlyRunId(store);
    store.close();
    const resumed = spawnSync(process.execPath, [BIN, "resume", runId], {
      cwd: dir,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(resumed.status).toBe(0);
    expect(marks(dir, 0)).toBe(1);
    expect(marks(dir, 2)).toBe(1);
    // Once if the kill came before it started, twice if it came during.
    expect(marks(dir, 1)).toBeGreaterThanOrEqual(1);
    const after = openStore(storePath(home));
    const records = after.lookup(runId);
    after.close();
    expect(records).toMatchObject([{ status: "succeeded" }]);
  }, 60_000);
});
