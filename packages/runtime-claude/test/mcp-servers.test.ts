/**
 * @file Tests for a node's named MCP servers on both drivers: they load beside
 *   Ork's, as written, and every session stays strict unless the run takes
 *   `--machine-claude`.
 */

import type { SessionSpec } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { buildCliArgs, buildSdkOptions } from "../src/index.ts";

const browser = { command: "npx", args: ["-y", "x"], env: { TOKEN: "${T}" } };

const spec: SessionSpec = {
  nodeId: "design",
  cwd: process.cwd(),
  prompt: "Design",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
  mcpServers: { browser },
};

const mcp = { url: "http://127.0.0.1:1/mcp", token: "tok" };

const human = {
  permit: () => Promise.resolve({ allow: true as const }),
  ask: () => Promise.resolve("a"),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The servers in the CLI's `--mcp-config`. */
const configIn = (args: string[]): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(
    args[args.indexOf("--mcp-config") + 1] ?? "{}",
  );
  const servers = isRecord(parsed) ? parsed["mcpServers"] : undefined;
  return isRecord(servers) ? servers : {};
};

describe("a node's named MCP servers", () => {
  it("load beside Ork's on the CLI driver, as written and strict", () => {
    const args = buildCliArgs(spec, mcp, []);
    expect(Object.keys(configIn(args)).toSorted()).toEqual(["browser", "ork"]);
    expect(configIn(args)["browser"]).toEqual(browser);
    expect(args).toContain("--strict-mcp-config");
  });

  it("load beside Ork's on the SDK driver, as written and strict", () => {
    const options = buildSdkOptions(spec, { human }, {});
    expect(options.mcpServers).toHaveProperty("ork");
    expect(options.mcpServers?.["browser"]).toEqual(browser);
    expect(options.strictMcpConfig).toBe(true);
  });

  it("add to the machine's under `--machine-claude`", () => {
    const machine = { ...spec, machineClaude: true };
    expect(buildCliArgs(machine, mcp, [])).not.toContain("--strict-mcp-config");
    expect(Object.keys(configIn(buildCliArgs(machine, mcp, [])))).toContain(
      "browser",
    );
    expect(buildSdkOptions(machine, { human }, {})).not.toHaveProperty(
      "strictMcpConfig",
    );
  });

  it("can't take the place of Ork's server", () => {
    const bad = { ...spec, mcpServers: { ork: { command: "evil" } } };
    expect(configIn(buildCliArgs(bad, mcp, []))["ork"]).toMatchObject({
      url: mcp.url,
    });
    expect(
      buildSdkOptions(bad, { human }, {}).mcpServers?.["ork"],
    ).toMatchObject({ type: "sdk" });
  });
});
