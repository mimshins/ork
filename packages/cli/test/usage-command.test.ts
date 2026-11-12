/**
 * @file Tests for `ork usage --clear-plan-limits` run through its real command
 *   against a store in a throwaway home: it says how many limits it forgot, or
 *   that there was none, and keeps stdout for the JSON report under `--json`.
 */

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, storePath } from "@krapht/ork-core";
import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usage } from "../src/commands/usage.ts";

/** A throwaway home whose store holds `limits` plan limits (0 or 1). */
const setup = (limits: number): void => {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-usage-")));
  vi.stubEnv("HOME", home);
  vi.stubEnv("ORK_PLAIN", "1");
  const store = openStore(storePath(home));
  if (limits > 0) {
    store.begin({
      id: "r1",
      workflow: "w",
      file: "/p/w.ork.yaml",
      project: "/p",
    });
    store.append("r1", {
      type: "node.event",
      id: "a",
      event: {
        type: "plan.limit",
        status: "rejected",
        window: "five_hour",
        resetsAt: "2030-01-01T00:00:00.000Z",
      },
    });
  }
  store.close();
};

type Ran = { out: string; err: string };

/** Runs `ork usage <args>` and what it printed. */
const ork = async (...args: string[]): Promise<Ran> => {
  let out = "";
  let err = "";
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(text => {
    out += String(text);
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(text => {
    err += String(text);
    return true;
  });
  try {
    await runCommand(usage, { rawArgs: args });
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  return { out, err };
};

afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

describe("ork usage --clear-plan-limits", () => {
  it("says how many limits it forgot", async () => {
    setup(1);
    const first = await ork("--clear-plan-limits");
    expect(first.out).toContain("Cleared 1 plan limit(s).");
    const second = await ork("--clear-plan-limits");
    expect(second.out).toContain("No plan limit was recorded.");
    expect(second.out).not.toContain("Cleared");
  });

  it("keeps stdout for the JSON report under --json", async () => {
    setup(1);
    const { out, err } = await ork("--clear-plan-limits", "--json");
    expect(err).toContain("Cleared 1 plan limit(s).");
    const report: unknown = JSON.parse(out);
    expect(report).toHaveProperty("limits");
  });
});
