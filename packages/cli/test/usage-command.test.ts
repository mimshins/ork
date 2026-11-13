/**
 * @file Tests for `ork usage --clear-plan-limits` run through its real command
 *   against a store in a throwaway home: it says how many limits it forgot, or
 *   that there was none, and keeps stdout for the JSON report under `--json`.
 */

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

/**
 * A home whose ledger holds a session of workflow `alpha` today and one of
 * `beta` on 2026-01-15.
 */
const seedSessions = (): void => {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-usage-")));
  vi.stubEnv("HOME", home);
  vi.stubEnv("ORK_PLAIN", "1");
  const store = openStore(storePath(home));
  for (const workflow of ["alpha", "beta"]) {
    const id = `run-${workflow}`;
    store.begin({ id, workflow, file: "/p/w.ork.yaml", project: "/p" });
    store.append(id, {
      type: "node.event",
      id: "a",
      event: {
        type: "session.finished",
        outcome: {
          subtype: "success",
          sessionId: `s-${workflow}`,
          report: { status: "pass", summary: "", artifacts: {}, fields: {} },
          text: "",
          usage: {
            costUsd: workflow === "alpha" ? 2 : 1,
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            turns: 1,
            durationMs: 1,
          },
          errors: [],
        },
      },
    });
  }
  store.close();
  const db = new DatabaseSync(storePath(home));
  db.exec(
    "UPDATE usage SET at = '2026-01-15T12:00:00.000Z' WHERE workflow = 'beta'",
  );
  db.close();
};

/** The report `ork usage <args> --json` prints, for every project. */
const reported = async (...args: string[]): Promise<unknown> =>
  JSON.parse((await ork("--project", "all", ...args, "--json")).out);

/** What a report says of workflows: alpha costs more, so it comes first. */
const workflows = (...keys: string[]): object => ({
  groups: { workflow: keys.map(key => ({ key })) },
});

describe("ork usage filters reach the store", () => {
  it("--workflow, --since and --until choose the sessions", async () => {
    seedSessions();
    expect(await reported("--since", "all")).toMatchObject(
      workflows("alpha", "beta"),
    );
    expect(
      await reported("--since", "all", "--workflow", "beta"),
    ).toMatchObject(workflows("beta"));
    expect(
      await reported("--since", "2026-01-01", "--until", "2026-02-01"),
    ).toMatchObject(workflows("beta"));
    expect(await reported("--since", "2026-02-01")).toMatchObject(
      workflows("alpha"),
    );
    expect(
      await reported("--since", "all", "--until", "2025-01-01"),
    ).toMatchObject(workflows());
  });
});

describe("ork usage filters", () => {
  it("reads --project all, with no warning", async () => {
    setup(0);
    const { out, err } = await ork("--project", "all", "--since", "all");
    expect(out).toContain("No Claude sessions in every project.");
    expect(err).toBe("");
  });

  it("refuses a given --project that is not registered", async () => {
    setup(0);
    const { out, err } = await ork("--project", "nope");
    expect(out).toBe("");
    expect(err).toContain("No registered project `nope`");
    expect(process.exitCode).toBe(1);
  });

  it("refuses a bad --since and --until naming the flag", async () => {
    setup(0);
    const since = await ork("--since", "soon");
    expect(since.err).toContain("--since takes an age (30d)");
    const until = await ork("--until", "2026-13-99");
    expect(until.err).toContain("--until takes a day");
    expect(process.exitCode).toBe(1);
  });

  it("has no --ids and no --limit", () => {
    for (const flag of ["workflow", "project", "since", "until", "json"]) {
      expect(usage.args).toHaveProperty(flag);
    }
    expect(usage.args).not.toHaveProperty("ids");
    expect(usage.args).not.toHaveProperty("limit");
  });
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
