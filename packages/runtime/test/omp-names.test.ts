/**
 * @file The `omp` driver's tool names (RFC-026): its built-ins and Ork's tools
 *   under the plugin's prefix map to Ork's words, and anything else is a name
 *   Ork does not know.
 */

import { describe, expect, it } from "vitest";

import {
  OMP_ORK_PREFIX,
  OMP_PLUGIN,
  ompToolName,
} from "../src/adapters/omp-names.ts";

describe("omp tool names", () => {
  it("names the plugin and its prefix as omp spells them", () => {
    expect(OMP_PLUGIN).toBe("ork-session");
    expect(OMP_ORK_PREFIX).toBe("mcp__ork_session_ork_");
  });

  it.each([
    ["bash", "Bash"],
    ["read", "Read"],
    ["write", "Write"],
    ["edit", "Edit"],
    ["grep", "Grep"],
    ["glob", "Glob"],
    ["mcp__ork_session_ork_ask_user", "mcp__ork__ask_user"],
    ["mcp__ork_session_ork_report", "mcp__ork__report"],
  ])("maps %s to %s", (name, ork) => {
    expect(ompToolName(name)).toBe(ork);
  });

  it.each([
    "eval",
    "task",
    "Bash",
    "constructor",
    "mcp__ork_session_ork_",
    "mcp__other_server_tool",
  ])("knows no tool %s", name => {
    expect(ompToolName(name)).toBeUndefined();
  });
});
