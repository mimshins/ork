/**
 * @file Tests that the `ork init` command passes the links it made to the
 *   linking warning: the paths `linkTools` reports as created must match the
 *   ones the command looks for, or the warning is silently dropped.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCommand } from "citty";
import { afterEach, expect, it, vi } from "vitest";

import { init } from "../src/commands/setup.ts";
import { STARTER_FILE } from "../src/project/init.ts";
import { LINK_WARNING } from "../src/project/link.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const tmp = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

it("prints the linking warning when the run linked a tool folder", async () => {
  const root = tmp("ork-init-");
  mkdirSync(path.join(root, ".ork", "agents"), { recursive: true });
  mkdirSync(path.join(root, ".claude"));
  // An existing starter skips the driver probe, which would run real tools.
  mkdirSync(path.dirname(path.join(root, STARTER_FILE)), { recursive: true });
  writeFileSync(path.join(root, STARTER_FILE), "");
  vi.stubEnv("HOME", tmp("ork-init-home-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    lines.push(String(chunk));
    return true;
  });
  await runCommand(init, { rawArgs: ["--no-skills", "--no-issues"] });
  const out = lines.join("");
  expect(out).toContain(".claude/agents");
  expect(out).toContain(LINK_WARNING);
});
