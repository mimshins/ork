/**
 * @file Tests that the fake `cmd` (`fixtures/fake-command.mjs`) prints what
 *   Command Code 1.88.5 prints in `-p --output-format json` mode, as measured
 *   (specs/architecture.md, "Command Code"): `{"type":"event"}` frames, then
 *   one `{"type":"result"}` line, exit code 8 when the turns run out, and a
 *   call the session mod (`--mod`) blocks as a `tool_hook_blocked` frame.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { writeMod } from "../src/index.ts";

const FAKE = fileURLToPath(
  new URL("fixtures/fake-command.mjs", import.meta.url),
);

const run = (
  scenario: string,
  extra: string[] = [],
): { status: number | null; lines: unknown[] } => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-fake-cmd-"));
  const env = { ...process.env, HOME: cwd, FAKE_SCENARIO: scenario };
  spawnSync(FAKE, ["mcp", "add", "--scope", "local", "ork", "http://x/mcp"], {
    cwd,
    env,
  });
  const done = spawnSync(
    FAKE,
    [
      "-p",
      "Do the task",
      "--output-format",
      "json",
      "--max-turns",
      "1",
      ...extra,
    ],
    { cwd, env, encoding: "utf8" },
  );
  return {
    status: done.status,
    lines: done.stdout
      .trim()
      .split("\n")
      .map(line => JSON.parse(line) as unknown),
  };
};

describe("the fake cmd", () => {
  it("answers --version before it reads any scenario", () => {
    const done = spawnSync(FAKE, ["--version"], { encoding: "utf8" });
    expect(done.status).toBe(0);
    expect(done.stdout).toBe("1.88.5\n");
  });

  it("ends a session out of turns with a max_turns result and exit code 8", () => {
    const { status, lines } = run("max-turns");
    expect(status).toBe(8);
    expect(lines.slice(0, 2)).toEqual([
      { type: "event", event: { type: "run_start", sessionId: "fake-cmd-1" } },
      { type: "event", event: { type: "turn_start", turnNumber: 1 } },
    ]);
    expect(lines.at(-1)).toEqual(
      expect.objectContaining({
        type: "result",
        subtype: "max_turns",
        sessionId: "fake-cmd-1",
        stopReason: "max_turns",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 80,
          cacheWriteTokens: 5,
        },
        finalText: "",
      }),
    );
  });

  it("blocks a shell call its session mod refuses, as frames", () => {
    const mod = writeMod({
      nodeId: "n",
      cwd: tmpdir(),
      prompt: "",
      systemAppend: "",
      settingSources: [],
      tools: { allow: [], deny: [] },
      permissionMode: "default",
      reportSchema: {},
    });
    const { status, lines } = run("try-denied", ["--mod", mod.file]);
    mod.remove();
    expect(status).toBe(0);
    expect(lines).toContainEqual({
      type: "event",
      event: {
        type: "tool_hook_blocked",
        toolCallId: "t9",
        toolName: "shell",
        hookOutput: "Ork: shell is not allowed for this node. Do not retry it.",
      },
    });
  });
});
