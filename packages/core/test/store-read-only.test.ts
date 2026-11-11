/**
 * @file Tests for the store opened read-only (tab completion): it reads what a
 *   writable store recorded, refuses writes, never creates a file, and refuses
 *   a store at another schema version; and a run's nodes in order.
 */

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { openStore, type RunEvent } from "../src/index.ts";

const EVENTS: RunEvent[] = [
  { type: "node.started", id: "lead", nodeType: "agent.leader", round: 1 },
  { type: "node.started", id: "check", nodeType: "agent.worker", round: 1 },
  { type: "node.skipped", id: "ship" },
  { type: "node.skipped", id: "lead" },
];

/** A store file with one run of three nodes, closed. */
const seededFile = (): string => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "ork-ro-")), "s.db");
  const store = openStore(file);
  store.begin({ id: "r1", workflow: "w", file: "/w", project: "/p" });
  for (const event of EVENTS) store.append("r1", event);
  store.close();
  return file;
};

/** Sets a store file's schema version, as a newer Ork would have left it. */
const setVersion = (file: string, version: number): void => {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA user_version = ${String(version)}`);
  db.close();
};

describe("a read-only store", () => {
  it("reads runs and a run's nodes, in the order they first appear", () => {
    const store = openStore(seededFile(), { readOnly: true });
    expect(store.runs().map(r => r.id)).toEqual(["r1"]);
    expect(store.nodes("r1")).toEqual(["lead", "check", "ship"]);
    store.close();
  });

  it("refuses every write", () => {
    const store = openStore(seededFile(), { readOnly: true });
    expect(() =>
      store.begin({ id: "r2", workflow: "w", file: "/w", project: "/p" }),
    ).toThrow(/readonly/u);
    store.close();
  });

  it("never creates a store that isn't there", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "ork-ro-")), "s.db");
    expect(() => openStore(file, { readOnly: true })).toThrow(
      /unable to open/u,
    );
    expect(existsSync(file)).toBe(false);
  });

  it("refuses a store at another schema version", () => {
    const file = seededFile();
    setVersion(file, 999);
    expect(() => openStore(file, { readOnly: true })).toThrow(
      /schema version 999/u,
    );
  });
});
