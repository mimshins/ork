/**
 * @file End-to-end test of `ork stop` on a live run whose session has spent:
 *   the command, run for real, ends the run `interrupted`, and the usage
 *   ledger's row, `ork ps` and `ork usage` agree on its status and spend.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { countedTokens, openStore, storePath } from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it } from "vitest";

import { runWorkflowFile } from "../src/index.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const WORKFLOW = [
  "schemaVersion: 1",
  "name: spender",
  "nodes:",
  "  write: { type: agent.worker, isolation: shared, prompt: Write }",
  "",
].join("\n");

/**
 * `ork <args>` for real, in `cwd`, with only this `~`. It is async, not
 * `spawnSync`, because the run it talks to lives in this process.
 */
const ork = (home: string, cwd: string, ...args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      {
        cwd,
        encoding: "utf8",
        env: { PATH: process.env["PATH"] ?? "", HOME: home, NO_COLOR: "1" },
      },
      (error, stdout) => {
        if (error === null) resolve(stdout);
        else reject(new Error(`ork ${args.join(" ")}: ${error.message}`));
      },
    );
  });

/** A run of `spend` that waits to be stopped, its store in its own `~`. */
const spendingRun = () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-stop-")));
  writeFileSync(path.join(dir, "spender.ork.yaml"), WORKFLOW);
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-home-")));
  const store = openStore(storePath(home));
  const env = { ...process.env, FAKE_SCENARIO: "spend" };
  const done = runWorkflowFile({
    file: "spender.ork.yaml",
    cwd: dir,
    inputs: [],
    inPlace: true,
    json: false,
    runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE, env })),
    driverChecks: openCodeReady,
    drivers: standInDrivers,
    store,
    home,
    out: () => {},
    err: () => {},
    installed: () => true,
  });
  return { dir, home, store, done };
};

/** The one item of `items`, which must be the only one. */
const theOne = <T>(items: readonly T[]): T => {
  const [first] = items;
  if (first === undefined || items.length !== 1) {
    throw new Error(`expected one, found ${String(items.length)}`);
  }
  return first;
};

/** How many of the session's words the run has stored: fake `spend` says six. */
const wordsStored = (store: ReturnType<typeof openStore>): number => {
  const [record] = store.runs();
  if (record === undefined) return 0;
  return store
    .events(record.id)
    .filter(
      ({ event }) =>
        event.type === "node.event" && event.event.type === "assistant.text",
    ).length;
};

describe("ork stop, end to end", () => {
  it("leaves the ledger, `ork ps` and `ork usage` agreeing on the run's spend and status", async () => {
    const live = spendingRun();
    await expect.poll(() => wordsStored(live.store)).toBe(6);
    const record = theOne(live.store.runs());
    const stopped = await ork(live.home, live.dir, "stop", record.id);
    expect(stopped).toContain(`! run ${record.id} interrupted`);
    const { result } = await live.done;
    expect(result?.status).toBe("interrupted");

    const row = theOne(live.store.usage());
    expect(row).toMatchObject({
      runId: record.id,
      node: "write",
      failed: true,
    });
    const spent = countedTokens(row);
    expect(spent).toBeGreaterThan(0);

    const listed: unknown = JSON.parse(
      await ork(live.home, live.dir, "ps", "--json"),
    );
    expect(listed).toMatchObject([
      {
        id: record.id,
        status: "interrupted",
        costUsd: row.costUsd,
        tokens: spent,
      },
    ]);

    const report: unknown = JSON.parse(
      await ork(live.home, live.dir, "usage", "--project", "all", "--json"),
    );
    expect(report).toMatchObject({
      totals: { costUsd: row.costUsd, tokens: spent, runs: 1 },
    });
    live.store.close();
  }, 60_000);
});
