/**
 * @file Tests that the `open-code` decoder marks OpenCode's own refusal of a
 *   call (a deny rule's `Permission denied: <action>`, or the non-interactive
 *   run's rejection) as `fault: "refused"`, from the fake `opencode`'s
 *   `try-denied` call, and leaves an ordinary failure unmarked.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Rule } from "../src/adapters/open-code-config.ts";
import { decodeOpenCodeLine } from "../src/adapters/open-code-events.ts";
import { BAD_ARGUMENTS } from "../src/tools/tool.ts";

const FAKE = fileURLToPath(
  new URL("fixtures/fake-opencode.mjs", import.meta.url),
);

/** The `tool.result` the fake's `try-denied` shell call decodes to. */
const tryDenied = (permissions: Rule[]) => {
  const dir = mkdtempSync(path.join(tmpdir(), "ork-oc-refused-"));
  const config = path.join(dir, "opencode.json");
  writeFileSync(
    config,
    JSON.stringify({
      mcp: { servers: { ork: { url: "http://127.0.0.1:9" } } },
      permissions,
    }),
  );
  const run = spawnSync(process.execPath, [FAKE, "run", "go"], {
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCODE_CONFIG: config,
      FAKE_SCENARIO: "try-denied",
    },
  });
  return run.stdout
    .split("\n")
    .flatMap(line => decodeOpenCodeLine(line).events)
    .find(event => event.type === "tool.result");
};

/** What one failed `shell` call with this error decodes to. */
const failed = (error: string) =>
  decodeOpenCodeLine(
    JSON.stringify({
      type: "tool_use",
      part: {
        id: "t",
        tool: "shell",
        state: { status: "error", input: {}, error },
      },
    }),
  ).events.at(-1);

const DENY_ALL: Rule = { action: "*", resource: "*", effect: "deny" };

describe("an OpenCode refusal", () => {
  it("is the agent's context gap when a deny rule refuses the call", () => {
    expect(tryDenied([DENY_ALL])).toEqual({
      type: "tool.result",
      id: "call_1",
      isError: true,
      fault: "refused",
    });
  });

  it("is not there when the call is allowed", () => {
    expect(
      tryDenied([
        DENY_ALL,
        { action: "shell", resource: "ls", effect: "allow" },
      ]),
    ).toEqual({ type: "tool.result", id: "call_1", isError: false });
  });

  it("covers the non-interactive run's rejection of an ask", () => {
    expect(
      failed(
        "This non-interactive run cannot ask the user for permission, so the request was rejected. Continue without this action.",
      ),
    ).toMatchObject({ fault: "refused" });
  });

  it("is not an ordinary failure, nor a command's own permission error", () => {
    expect([
      failed("Command failed"),
      failed("ls: /root: Permission denied"),
      failed("Permission denied: shell\nand more"),
    ]).toEqual([
      { type: "tool.result", id: "t", isError: true },
      { type: "tool.result", id: "t", isError: true },
      { type: "tool.result", id: "t", isError: true },
    ]);
  });

  it("leaves refused arguments to an Ork tool as the arguments' fault", () => {
    expect(failed(`${BAD_ARGUMENTS} steps`)).toMatchObject({
      fault: "arguments",
    });
  });
});
