/**
 * @file Tests for the flags every list shares (RFC-017): the citty flags made
 *   from a field table (enum options, `--ids` only where a list has ids,
 *   `--limit`, `--json`), `--limit` and filter values refused with what they
 *   take, `--project` checked against the registered ones, `--ids` and `--json`
 *   printing.
 */

import {
  FOLLOW_UP_KINDS,
  followUpListTable,
  type ListTable,
  RUN_LIST_STATUSES,
  runListTable,
  usageListTable,
  worktreeListTable,
} from "@krapht/ork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { filterArgs, projectScope, readListArgs } from "../src/list/flags.ts";
import { printList } from "../src/list/print.ts";

type Row = { id: string };
const rowTable: ListTable<Row> = { fields: [], id: row => row.id };
const rows: Row[] = [{ id: "a1" }, { id: "b2" }, { id: "c3" }];

/** What `body` wrote to stdout and stderr, and the exit code it set. */
const capture = (
  body: () => void,
): { out: string; err: string; code: number | string | undefined } => {
  let out = "";
  let err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    out += String(chunk);
    return true;
  });
  const e = vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
    err += String(chunk);
    return true;
  });
  process.exitCode = undefined;
  try {
    body();
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
  const code = process.exitCode;
  process.exitCode = undefined;
  return { out, err, code };
};

const NOW = Date.parse("2026-11-13T12:00:00Z");

const read = (args: Record<string, unknown>) =>
  capture(() => {
    readListArgs(runListTable, args, { now: NOW });
  });

afterEach(() => {
  process.exitCode = undefined;
});

describe("filterArgs", () => {
  it("makes a flag per field, an enum's values as options, then ids, limit, json", () => {
    const args = filterArgs(runListTable);
    expect(Object.keys(args)).toEqual([
      "status",
      "workflow",
      "project",
      "since",
      "until",
      "ids",
      "limit",
      "json",
    ]);
    expect(args["status"]).toMatchObject({
      type: "enum",
      options: [...RUN_LIST_STATUSES, "all"],
    });
    expect(args["workflow"]).toMatchObject({ type: "string" });
    expect(args["limit"]).toMatchObject({ type: "string" });
  });

  it("an enum without `all` carries its values alone", () => {
    expect(filterArgs(followUpListTable)["kind"]).toMatchObject({
      options: FOLLOW_UP_KINDS,
    });
  });

  it("has --ids only for a list with ids, and honors the options", () => {
    expect(Object.keys(filterArgs(usageListTable))).not.toContain("ids");
    expect(Object.keys(filterArgs(worktreeListTable))).toContain("ids");
    expect(Object.keys(filterArgs(usageListTable, { limit: false }))).toEqual([
      "workflow",
      "project",
      "since",
      "until",
      "json",
    ]);
    expect(Object.keys(filterArgs(rowTable))).toEqual(["ids", "limit", "json"]);
    expect(
      Object.keys(filterArgs(rowTable, { ids: false, json: false })),
    ).toEqual(["limit"]);
  });

  it("lets the command's own flags win", () => {
    const args = filterArgs(rowTable, {
      extra: { json: { type: "boolean", description: "Mine" } },
    });
    expect(args["json"]).toMatchObject({ description: "Mine" });
  });
});

describe("readListArgs", () => {
  it("checks the values and returns the filter and the limit", () => {
    const got = readListArgs(
      runListTable,
      { status: "failed", workflow: "build", since: "24h", limit: "5" },
      { now: NOW },
    );
    expect(got?.limit).toBe(5);
    expect(got?.filter).toMatchObject({ status: "failed", workflow: "build" });
    expect(got?.filter["since"]).toBe("2026-11-12T12:00:00.000Z");
  });

  it.each(["0", "-1", "abc", "2.5", ""])("refuses --limit %j", limit => {
    const result = read({ limit });
    expect(result.code).toBe(1);
    expect(result.err).toContain("--limit takes a positive whole number");
  });

  it("refuses a wrong value, naming the flag and what it takes", () => {
    const result = read({ status: "bad" });
    expect(result.code).toBe(1);
    expect(result.err).toContain("--status takes one of running, paused");
    expect(result.err).toContain("`bad`");
  });

  it("refuses --ids with --json", () => {
    const result = read({ ids: true, json: true });
    expect(result.code).toBe(1);
    expect(result.err).toContain("--ids and --json");
  });
});
describe("projectScope", () => {
  const projects = [
    { id: "ork", root: "/code/ork" },
    { id: "web", root: "/code/web" },
  ];

  it("is here when not given, all for all, the root for an id or a root", () => {
    expect(projectScope({}, projects)).toBe("here");
    expect(projectScope({ project: "all" }, projects)).toBe("all");
    expect(projectScope({ project: "web" }, projects)).toEqual({
      root: "/code/web",
    });
    expect(projectScope({ project: "/code/ork" }, projects)).toEqual({
      root: "/code/ork",
    });
  });

  it("refuses one not registered, listing the registered", () => {
    const result = capture(() => {
      expect(projectScope({ project: "nope" }, projects)).toBeUndefined();
    });
    expect(result.err).toBe(
      "No registered project `nope`; registered: ork, web.\n",
    );
    expect(result.code).toBe(1);
  });
});

describe("printList", () => {
  const human = vi.fn<(rows: readonly Row[]) => void>();
  beforeEach(() => human.mockClear());

  it("prints --ids comma-separated on one line", () => {
    const result = capture(() => {
      printList(rows, rowTable, { ids: true }, human);
    });
    expect(result.out).toBe("a1,b2,c3\n");
    expect(human).not.toHaveBeenCalled();
  });

  it("prints nothing for --ids of no rows, and exits 0", () => {
    const result = capture(() => {
      printList([], rowTable, { ids: true }, human);
    });
    expect(result).toEqual({ out: "", err: "", code: undefined });
  });

  it("refuses --ids with --json", () => {
    const result = capture(() => {
      printList(rows, rowTable, { ids: true, json: true }, human);
    });
    expect(result.out).toBe("");
    expect(result.code).toBe(1);
  });

  it("prints --json, or what json maps the rows to", () => {
    expect(
      JSON.parse(
        capture(() => {
          printList(rows, rowTable, { json: true }, human);
        }).out,
      ),
    ).toEqual(rows);
    expect(
      JSON.parse(
        capture(() => {
          printList(rows, rowTable, { json: true }, human, r => r.length);
        }).out,
      ),
    ).toBe(3);
  });

  it("hands the rows to human otherwise", () => {
    capture(() => {
      printList(rows, rowTable, {}, human);
    });
    expect(human).toHaveBeenCalledWith(rows);
  });
});
