/**
 * @file Tests for forking a session (`SessionSpec.fork`, ADR-063): both drivers
 *   resume a copy of the session, never the session itself, take only the
 *   built-in tools it is given and no MCP server but Ork's (even in a run that
 *   loads the machine's Claude setup), and the stand-in `claude` answers as a
 *   fork, under a session of its own.
 */

import { fileURLToPath } from "node:url";

import type { RuntimeEvent, SessionSpec } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import {
  buildCliArgs,
  buildSdkOptions,
  createCliRuntime,
} from "../src/index.ts";

const FAKE_CLAUDE = fileURLToPath(
  new URL("fixtures/fake-claude.mjs", import.meta.url),
);

const spec: SessionSpec = {
  nodeId: "lead",
  cwd: process.cwd(),
  model: "opus",
  prompt: "Which approach?",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: [], deny: ["Write"] },
  permissionMode: "default",
  reportSchema: {
    type: "object",
    properties: { choice: { enum: ["b", "ask-user"] } },
  },
  resume: "lead-1",
  fork: true,
};

const human = {
  permit: () => Promise.resolve({ allow: true as const }),
  ask: () => Promise.resolve("a"),
};

const collect = async (events: AsyncIterable<RuntimeEvent>) => {
  const all: RuntimeEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
};

describe("a fork", () => {
  it("is `--resume` with `--fork-session` on the CLI driver, and only with a resume", () => {
    const mcp = { url: "http://127.0.0.1:1/mcp", token: "tok" };
    const args = buildCliArgs(spec, mcp, []);
    expect(
      args.slice(args.indexOf("--resume"), args.indexOf("--resume") + 3),
    ).toEqual(["--resume", "lead-1", "--fork-session"]);
    const { resume: _resume, ...fresh } = spec;
    expect(buildCliArgs(fresh, mcp, [])).not.toContain("--fork-session");
  });

  it("is `forkSession` on the SDK driver", () => {
    const options = buildSdkOptions(
      spec,
      { human },
      { ANTHROPIC_API_KEY: "k" },
    );
    expect(options).toMatchObject({ resume: "lead-1", forkSession: true });
    expect(
      buildSdkOptions({ ...spec, fork: false }, { human }, {}),
    ).not.toHaveProperty("forkSession");
  });

  it("has only the tools it is given, and no MCP server but Ork's, on both drivers", () => {
    // Strict even in a run that loads the machine's Claude setup (ADR-065).
    const readOnly: SessionSpec = {
      ...spec,
      machineClaude: true,
      tools: { allow: [], deny: [], only: ["Read", "Grep"], strictMcp: true },
    };
    const mcp = { url: "http://127.0.0.1:1/mcp", token: "tok" };
    const args = buildCliArgs(readOnly, mcp, []);
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Grep");
    const machine = { ...spec, machineClaude: true };
    expect(buildCliArgs(machine, mcp, [])).not.toContain("--strict-mcp-config");

    expect(buildSdkOptions(readOnly, { human }, {})).toMatchObject({
      tools: ["Read", "Grep"],
      strictMcpConfig: true,
    });
    expect(buildSdkOptions(machine, { human }, {})).not.toHaveProperty(
      "strictMcpConfig",
    );
  });

  it("runs as a session of its own against the stand-in claude", async () => {
    const events = await collect(
      createCliRuntime({ bin: FAKE_CLAUDE }).start(spec, { human }).events,
    );
    expect(events[0]).toMatchObject({
      type: "session.started",
      sessionId: "fork-of-lead-1",
    });
    expect(events.at(-1)).toMatchObject({
      type: "session.finished",
      outcome: {
        subtype: "success",
        report: { fields: { choice: "b", note: "The spec settles it." } },
      },
    });
  });
});
