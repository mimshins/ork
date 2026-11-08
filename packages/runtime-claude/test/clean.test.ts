/**
 * @file Tests for clean sessions (ADR-065): by default both drivers load no MCP
 *   server but Ork's, turn Claude Code's auto-memory off, and keep the
 *   per-machine sections out of the system prompt; a session of a run started
 *   with `--machine-claude` gets the machine's MCP servers and memory back, and
 *   still leaves those sections out. The CLI driver runs a stand-in `claude`.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RuntimeEvent, SessionSpec } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import {
  buildCliArgs,
  buildSdkOptions,
  createCliRuntime,
  driverEnv,
  EXCLUDE_DYNAMIC_SECTIONS,
  NO_AUTO_MEMORY,
} from "../src/index.ts";

const FAKE_CLAUDE = fileURLToPath(
  new URL("fixtures/fake-claude.mjs", import.meta.url),
);

const clean: SessionSpec = {
  nodeId: "write",
  cwd: process.cwd(),
  prompt: "Write the notes",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
};

const machine: SessionSpec = { ...clean, machineClaude: true };

const mcp = { url: "http://127.0.0.1:1/mcp", token: "tok" };

const human = {
  permit: () => Promise.resolve({ allow: true as const }),
  ask: () => Promise.resolve("a"),
};

const collect = async (events: AsyncIterable<RuntimeEvent>) => {
  const all: RuntimeEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
};

/** What the stand-in `claude` saw of the memory switch, for `given`. */
const memorySeen = async (given: SessionSpec): Promise<string> => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "ork-clean-")), "m");
  const { [NO_AUTO_MEMORY]: _mine, ...env } = process.env;
  const session = createCliRuntime({
    bin: FAKE_CLAUDE,
    env: { ...env, FAKE_CLAUDE_MEMORY_FILE: file },
  }).start(given, { human });
  await collect(session.events);
  return readFileSync(file, "utf8");
};

describe("a clean session", () => {
  it("has no MCP server but Ork's and no per-machine prompt sections on the CLI driver", () => {
    const args = buildCliArgs(clean, mcp, []);
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain(EXCLUDE_DYNAMIC_SECTIONS);
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("project,local");
  });

  it("has no MCP server but Ork's and no per-machine prompt sections on the SDK driver", () => {
    const options = buildSdkOptions(
      clean,
      { human },
      { ANTHROPIC_API_KEY: "k" },
    );
    expect(options).toMatchObject({
      strictMcpConfig: true,
      settingSources: ["project", "local"],
      systemPrompt: { excludeDynamicSections: true },
      env: { [NO_AUTO_MEMORY]: "1", ANTHROPIC_API_KEY: "k" },
    });
  });

  it("turns auto-memory off in the CLI driver's process", async () => {
    expect(driverEnv(clean)).toEqual({ [NO_AUTO_MEMORY]: "1" });
    expect(await memorySeen(clean)).toBe("1");
  });
});

describe("a session with the machine's Claude setup", () => {
  it("loads the machine's MCP servers, and still leaves the per-machine sections out, on the CLI driver", () => {
    const args = buildCliArgs(machine, mcp, []);
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).toContain(EXCLUDE_DYNAMIC_SECTIONS);
  });

  it("loads the machine's MCP servers and memory on the SDK driver", () => {
    const options = buildSdkOptions(
      machine,
      { human },
      { ANTHROPIC_API_KEY: "k" },
    );
    expect(options).not.toHaveProperty("strictMcpConfig");
    expect(options.env).not.toHaveProperty(NO_AUTO_MEMORY);
    expect(options.systemPrompt).toMatchObject({
      excludeDynamicSections: true,
    });
  });

  it("leaves auto-memory on in the CLI driver's process", async () => {
    expect(driverEnv(machine)).toEqual({});
    expect(await memorySeen(machine)).toBe("");
  });

  it("keeps a spec's own strict MCP, as a leader's question fork asks", () => {
    const strict = { ...machine, tools: { ...machine.tools, strictMcp: true } };
    expect(buildCliArgs(strict, mcp, [])).toContain("--strict-mcp-config");
    expect(buildSdkOptions(strict, { human }, {})).toMatchObject({
      strictMcpConfig: true,
    });
  });
});
