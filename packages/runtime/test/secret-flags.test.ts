/**
 * @file Tests for what keeps Ork's token off a session's argv: the claude-code
 *   adapter passes its MCP config and settings as private files, and the
 *   private folder refuses a root that isn't this user's own.
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SessionSpec } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import {
  claudeCodeAdapter,
  makeSecretFolder,
  withoutSecretFlags,
} from "../src/index.ts";

const tmp = (name: string): string =>
  mkdtempSync(path.join(tmpdir(), `ork-${name}-`));

const endpoint = { url: "http://127.0.0.1:1/mcp", token: "s3cret-token" };

const spec: SessionSpec = {
  nodeId: "build",
  cwd: "/w",
  prompt: "p",
  systemAppend: "",
  settingSources: [],
  permissionMode: "default",
  reportSchema: { type: "object" },
  tools: { allow: [], deny: [] },
  settings: { env: { A: "1" } },
};

const valueAfter = (args: readonly string[], flag: string): string =>
  args[args.indexOf(flag) + 1] ?? "";

describe("claude-code's token", () => {
  it("is not on the Command's argv", () => {
    const args = claudeCodeAdapter.command.args(spec, {
      endpoint,
      allowed: [],
    });
    expect(args.join(" ")).not.toContain("s3cret-token");
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--settings");
  });

  it("is in 0600 files the wiring names, removed when the session ends", async () => {
    const wired = await claudeCodeAdapter.mcp.wire(spec, endpoint, {
      waiting: () => {
        // Nothing waits here.
      },
      signal: new AbortController().signal,
      bin: "claude",
      env: {},
    });
    const config = valueAfter(wired.args, "--mcp-config");
    expect(readFileSync(config, "utf8")).toContain("Bearer s3cret-token");
    expect(statSync(config).mode & 0o777).toBe(0o600);
    expect(
      readFileSync(valueAfter(wired.args, "--settings"), "utf8"),
    ).toContain('"A":"1"');
    await wired.release();
    expect(() => statSync(config)).toThrow(/ENOENT/u);
  });

  it("drops each secret flag with its value, and nothing else", () => {
    const args = [
      "-p",
      "--mcp-config",
      "{}",
      "--model",
      "m",
      "--settings",
      "{}",
    ];
    expect(withoutSecretFlags(args)).toEqual(["-p", "--model", "m"]);
  });
});

describe("a private folder's root", () => {
  it("is closed to others when it was left open", () => {
    const root = path.join(tmp("secret"), "root");
    mkdirSync(root);
    chmodSync(root, 0o755);
    makeSecretFolder(root).remove();
    expect(statSync(root).mode & 0o777).toBe(0o700);
  });

  it("is refused when it is a link", () => {
    const base = tmp("secret");
    const root = path.join(base, "root");
    symlinkSync(tmp("elsewhere"), root);
    expect(() => makeSecretFolder(root)).toThrow(
      /not a folder of this user's/u,
    );
  });
});
