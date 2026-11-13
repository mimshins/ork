/**
 * @file Tests for what the filter bar knows without drawing: whether a filter
 *   is set, the CLI command it is the twin of (quoted, in the table's order,
 *   defaults never written), the field a refusal names, and the count line.
 */

import { describe, expect, it } from "vitest";

import {
  errorField,
  filterCommand,
  isFiltered,
  matchLine,
  withField,
} from "../../src/components/filter-model.ts";

describe("isFiltered", () => {
  it("is true only when a field has a value", () => {
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ status: undefined, run: "" })).toBe(false);
    expect(isFiltered({ status: "failed" })).toBe(true);
  });
});

describe("filterCommand", () => {
  it.each([
    ["runs", {}, "ork ps"],
    ["usage", {}, "ork usage"],
    ["decisions", {}, "ork decide --list"],
    ["follow-ups", {}, "ork follow-ups list"],
    ["feedback", {}, "ork feedback list"],
    ["worktrees", {}, "ork worktrees list"],
    ["runs", { status: "failed" }, "ork ps --status failed"],
  ] as const)("%s %j is `%s`", (list, values, command) => {
    expect(filterCommand(list, values)).toBe(command);
  });

  it("lists the set fields in the table's order, whatever order they were set in", () => {
    expect(
      filterCommand("runs", {
        since: "24h",
        workflow: "feature",
        status: "paused",
      }),
    ).toBe("ork ps --status paused --workflow feature --since 24h");
  });

  it("quotes a value with a space or a shell character", () => {
    expect(filterCommand("follow-ups", { for: "person:A B" })).toBe(
      "ork follow-ups list --for 'person:A B'",
    );
    expect(filterCommand("runs", { workflow: "a;b'c" })).toBe(
      "ork ps --workflow 'a;b'\\''c'",
    );
  });

  it("leaves out an empty value and a name the table doesn't have", () => {
    expect(filterCommand("worktrees", { run: "", nope: "x" })).toBe(
      "ork worktrees list",
    );
  });
});

describe("errorField", () => {
  it("reads the flag a refusal starts with", () => {
    expect(errorField("--status takes one of a, b, not `x`.")).toBe("status");
    expect(errorField("--follow-up-kind is bad")).toBe("follow-up-kind");
  });

  it("finds none in a message that doesn't start with one", () => {
    expect(errorField("No answer: offline")).toBeUndefined();
  });
});

describe("matchLine", () => {
  it.each([
    ["runs", 0, "No runs match."],
    ["runs", 1, "1 run matches."],
    ["runs", 3, "3 runs match."],
    ["feedback", 2, "2 feedback items match."],
  ] as const)("%s %i is `%s`", (list, count, line) => {
    expect(matchLine(list, count)).toBe(line);
  });
});

describe("withField", () => {
  it("sets, replaces and unsets a field without touching the rest", () => {
    expect(withField({ run: "a" }, "status", "failed")).toEqual({
      run: "a",
      status: "failed",
    });
    expect(withField({ run: "a" }, "run", "b")).toEqual({ run: "b" });
    expect(withField({ run: "a", status: "x" }, "run", "")).toEqual({
      status: "x",
    });
  });
});
