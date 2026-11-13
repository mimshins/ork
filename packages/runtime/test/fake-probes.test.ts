/**
 * @file Tests that the fake `claude`, `cmd` and `opencode` answer the probes
 *   `ork doctor` runs (`--version`, and `auth status --json` for claude) with
 *   no session flags, so a QA tester can put them on `PATH` and see a ready
 *   driver. fake-claude reads no `--mcp-config` for a probe, and a session
 *   started without `--model` reports the model `fake`.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { MIN_CLAUDE_VERSION, olderThan } from "@krapht/ork-integrations";
import { describe, expect, it } from "vitest";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

const probe = (name: string, args: string[]) =>
  spawnSync(fixture(name), args, { encoding: "utf8" });

describe("the fakes' probes", () => {
  it("fake claude prints a version doctor accepts, without --mcp-config", () => {
    const done = probe("fake-claude.mjs", ["--version"]);
    expect(done.status).toBe(0);
    expect(done.stdout).toMatch(/\d+\.\d+\.\d+/u);
    expect(olderThan(done.stdout, MIN_CLAUDE_VERSION)).toBe(false);
  });

  it("fake claude says it is logged in, without --mcp-config", () => {
    const done = probe("fake-claude.mjs", ["auth", "status", "--json"]);
    expect(done.status).toBe(0);
    expect(JSON.parse(done.stdout)).toMatchObject({ loggedIn: true });
  });

  it("fake claude reports the model `fake` for a session with no --model", () => {
    const mcp = JSON.stringify({
      mcpServers: { ork: { url: "http://127.0.0.1:1/mcp", headers: {} } },
    });
    const done = spawnSync(
      fixture("fake-claude.mjs"),
      ["-p", "--mcp-config", mcp],
      { encoding: "utf8", env: { ...process.env, FAKE_SCENARIO: "end:auth" } },
    );
    expect(
      JSON.parse(done.stdout.split("\n").slice(0, 1).join("")),
    ).toMatchObject({
      subtype: "init",
      model: "fake",
    });
  });

  it("fake cmd and fake opencode answer --version with exit 0", () => {
    const cmd = probe("fake-command.mjs", ["--version"]);
    const opencode = probe("fake-opencode.mjs", ["--version"]);
    expect([cmd.status, opencode.status]).toEqual([0, 0]);
    expect([cmd.stdout, opencode.stdout]).toEqual([
      expect.stringMatching(/\d+\.\d+\.\d+/u),
      expect.stringMatching(/\d+\.\d+\.\d+/u),
    ]);
  });
});
