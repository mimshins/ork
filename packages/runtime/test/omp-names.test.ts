/**
 * @file The `omp` driver's tool names (RFC-026): its built-ins and Ork's host
 *   tools (`ork_<tool>`) map to Ork's words, and anything else, an `mcp__` name
 *   among them, is a name Ork does not know.
 */

import { describe, expect, it } from "vitest";

import { OMP_HOST_PREFIX, ompToolName } from "../src/adapters/omp-names.ts";

describe("omp tool names", () => {
  it("names Ork's host tools with the ork_ prefix", () => {
    expect(OMP_HOST_PREFIX).toBe("ork_");
  });

  it.each([
    ["bash", "Bash"],
    ["read", "Read"],
    ["write", "Write"],
    ["edit", "Edit"],
    ["grep", "Grep"],
    ["glob", "Glob"],
    ["ork_ask_user", "mcp__ork__ask_user"],
    ["ork_report", "mcp__ork__report"],
  ])("maps %s to %s", (name, ork) => {
    expect(ompToolName(name)).toBe(ork);
  });

  it.each([
    "eval",
    "task",
    "Bash",
    "constructor",
    "ork_",
    "mcp__ork__report",
    "mcp__ork_session_ork_report",
    "mcp__other_server_tool",
  ])("knows no tool %s", name => {
    expect(ompToolName(name)).toBeUndefined();
  });
});
