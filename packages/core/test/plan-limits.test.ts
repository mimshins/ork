/**
 * @file Tests for the Ork version kept with each plan limit: a store opened
 *   with a version records it, a writable open forgets what other versions
 *   recorded except `rejected` limits, a read-only or unversioned open forgets
 *   nothing, and the migration that adds the column keeps the rows.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openStore, type PlanLimit } from "../src/index.ts";
import { migrate, MIGRATIONS } from "../src/store/schema.ts";

/** Where the migration that adds `plan_limits.ork_version` is. */
const VERSION_MIGRATION = MIGRATIONS.findIndex(
  step => typeof step === "string" && step.includes("ADD COLUMN ork_version"),
);

let dir = "";
let file = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ork-plan-limits-"));
  file = path.join(dir, "state.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Records a report of `window` through a store opened with `version`. */
const record = (
  version: string | undefined,
  window: string,
  status: PlanLimit["status"],
): void => {
  const store = openStore(file, version === undefined ? {} : { version });
  const id = `run-${window}`;
  store.begin({ id, workflow: "w", file: "/p/w.ork.yaml", project: "/p" });
  store.append(id, {
    type: "node.event",
    id: "a",
    event: {
      type: "plan.limit",
      status,
      window,
      resetsAt: "2030-01-01T00:00:00.000Z",
    },
  });
  store.close();
};

/** The windows and statuses a store opened with `options` keeps. */
const kept = (options: Parameters<typeof openStore>[1]) => {
  const store = openStore(file, options);
  const limits = store
    .planLimits()
    .map(({ window, status }) => `${window} ${status}`);
  store.close();
  return limits;
};

/** Each row's window and the Ork version that recorded it, read raw. */
const versions = (): string[] => {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db
    .prepare("SELECT name, ork_version FROM plan_limits ORDER BY name")
    .all()
    .map(r => `${String(r["name"])} ${String(r["ork_version"])}`);
  db.close();
  return rows;
};

/**
 * Stores limits of every status by 1.0.0, by no version, and by 2.0.0, written
 * directly: recording through a versioned store would forget the others.
 */
const recordMixed = (): void => {
  openStore(file).close();
  const db = new DatabaseSync(file);
  db.exec(`INSERT INTO plan_limits (name, status, resets_at, at, ork_version) VALUES
    ('old_warning', 'allowed_warning', NULL, '2026-11-20T00:00:00.000Z', '1.0.0'),
    ('old_allowed', 'allowed', NULL, '2026-11-20T00:00:00.000Z', '1.0.0'),
    ('old_rejected', 'rejected', NULL, '2026-11-20T00:00:00.000Z', '1.0.0'),
    ('none_warning', 'allowed_warning', NULL, '2026-11-20T00:00:00.000Z', ''),
    ('none_rejected', 'rejected', NULL, '2026-11-20T00:00:00.000Z', ''),
    ('new_warning', 'allowed_warning', NULL, '2026-11-20T00:00:00.000Z', '2.0.0')`);
  db.close();
};

describe("the Ork version of a plan limit", () => {
  it("is recorded from the store's version, or empty without one", () => {
    record("2.0.0", "seven_day", "allowed_warning");
    record(undefined, "five_hour", "rejected");
    expect(versions()).toEqual(["five_hour ", "seven_day 2.0.0"]);
  });

  it("forgets other versions' non-rejected limits at a writable open", () => {
    recordMixed();
    expect(kept({ version: "2.0.0" })).toEqual([
      "new_warning allowed_warning",
      "none_rejected rejected",
      "old_rejected rejected",
    ]);
  });

  it("forgets nothing at an open without a version", () => {
    recordMixed();
    expect(kept({})).toHaveLength(6);
  });

  it("forgets nothing at a read-only open", () => {
    recordMixed();
    expect(kept({ readOnly: true, version: "2.0.0" })).toHaveLength(6);
  });
});

describe("the migration that adds the version", () => {
  it("keeps the limits an older store recorded, with no version", () => {
    const db = new DatabaseSync(file);
    migrate(db, MIGRATIONS.slice(0, VERSION_MIGRATION));
    db.exec(`INSERT INTO plan_limits (name, status, resets_at, at)
      VALUES ('seven_day', 'allowed_warning', NULL, '2026-11-20T00:00:00.000Z')`);
    db.close();
    expect(kept({})).toEqual(["seven_day allowed_warning"]);
    expect(versions()).toEqual(["seven_day "]);
  });
});
