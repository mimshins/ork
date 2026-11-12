/**
 * @file Tests for what `ork doctor` says of the machine's ledgers: it removes
 *   the slot and lock records of processes that are gone, names them, and says
 *   nothing when there were none.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ledgerChecks } from "../src/doctor/ledger-checks.ts";

/** A process that has already ended. */
const deadPid = (): number => {
  const { pid } = spawnSync(process.execPath, ["-e", ""]);
  if (pid === undefined) throw new Error("no pid");
  return pid;
};

const record = (dir: string, run: string, pid: number): string => {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "slot-0.json");
  writeFileSync(file, JSON.stringify({ id: run, run, node: "push", pid }));
  return file;
};

describe("ork doctor's ledger checks", () => {
  it("removes stale slot and lock records and names them", () => {
    const home = mkdtempSync(path.join(tmpdir(), "ork-doctor-"));
    const pid = deadPid();
    const slot = record(path.join(home, ".ork", "slots"), "r1", pid);
    const lock = record(path.join(home, ".ork", "locks", "abc"), "r2", pid);
    const live = record(
      path.join(home, ".ork", "locks", "def"),
      "r3",
      process.pid,
    );
    expect(ledgerChecks(home)).toEqual([
      {
        name: "check slots",
        status: "ok",
        detail: `removed stale records of r1/push (pid ${String(pid)})`,
      },
      {
        name: "locks",
        status: "ok",
        detail: `removed stale records of r2/push (pid ${String(pid)})`,
      },
    ]);
    expect([existsSync(slot), existsSync(lock), existsSync(live)]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("says nothing when nothing is stale", () => {
    const home = mkdtempSync(path.join(tmpdir(), "ork-doctor-"));
    expect(ledgerChecks(home)).toEqual([]);
  });
});
