/**
 * @file Tests for `ork watch`'s pieces (RFC-011): what a run gets from what a
 *   check reported, which of it is untrusted, one watcher per machine, what a
 *   check's result has to be, and what it can't say.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, takeWatchLock, watchingPid } from "@krapht/ork-core";
import type { Trigger } from "@krapht/ork-schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { plain } from "../src/output.ts";
import { lookAt } from "../src/watch/look.ts";
import { acceptLines, statusLines } from "../src/watch/report.ts";
import {
  inputsFor,
  startTriggerRun,
  triggerRunArgs,
} from "../src/watch/start.ts";

const trigger = (inputs?: Record<string, string>): Trigger => ({
  every: "1m",
  run: "triage",
  ...(inputs === undefined ? {} : { inputs }),
});

const place = () => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-watch-"));
  return { root, mode: "in-repo" as const, dir: path.join(root, ".ork") };
};

const look = (script: string, env?: Record<string, string>) =>
  lookAt({
    place: place(),
    id: "t",
    check: {
      type: "tool.shell",
      script,
      ...(env === undefined ? {} : { env }),
    },
    signal: new AbortController().signal,
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("what a run of a trigger gets", () => {
  it("marks what the check reported as untrusted", () => {
    expect(
      inputsFor(trigger(), { key: "1", inputs: { issue: 12, title: "x" } }),
    ).toEqual({
      inputs: { issue: "12", title: "x" },
      untrusted: ["issue", "title"],
    });
  });

  it("lets the trigger's own inputs win, and trusts them", () => {
    expect(
      inputsFor(trigger({ mode: "safe" }), {
        key: "1",
        inputs: { mode: "unsafe", title: "x" },
      }),
    ).toEqual({ inputs: { mode: "safe", title: "x" }, untrusted: ["title"] });
  });
});

describe("one look", () => {
  it("reads what a check reports", async () => {
    const result = await look(
      `echo '{"events":[{"key":"1","inputs":{"issue":"one"}}]}'`,
    );
    expect(result).toEqual({
      ok: true,
      events: [{ key: "1", inputs: { issue: "one" } }],
    });
  });

  it("fails when a check says anything else", async () => {
    const result = await look(`echo '{"things":[]}'`);
    expect(result.ok).toBe(false);
  });

  it("fails when the check does", async () => {
    const result = await look("exit 3");
    expect(result).toMatchObject({ ok: false });
  });

  it("masks what it read through env: in the error it reports", async () => {
    const secret = "a-value-a-check-reads-42";
    vi.stubEnv("ORK_TEST_CHECK_SECRET", secret);
    const result = await look('echo "denied for $TOKEN" >&2; exit 3', {
      TOKEN: "{{env.ORK_TEST_CHECK_SECRET}}",
    });
    expect(result).toMatchObject({ ok: false });
    // The error does quote what the check said, with the value taken out.
    expect(JSON.stringify(result)).toContain("denied for [masked]");
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

const lockStore = () =>
  openStore(
    path.join(mkdtempSync(path.join(tmpdir(), "ork-watch-home-")), "state.db"),
  );

/** The lock's way to let go, when it was taken. */
const releaseOf = (taken: ReturnType<typeof takeWatchLock>): (() => void) => {
  if (!taken.ok) throw new Error("the lock wasn't taken");
  return taken.release;
};

describe("one ork watch per machine", () => {
  it("won't take a lock another holds", () => {
    const store = lockStore();
    expect(takeWatchLock(store).ok).toBe(true);
    expect(takeWatchLock(store)).toEqual({ ok: false, pid: process.pid });
    expect(watchingPid(store)).toBe(process.pid);
  });

  it("takes a lock whose process has gone", () => {
    const store = lockStore();
    expect(takeWatchLock(store, 99_999_999).ok).toBe(true);
    expect(watchingPid(store)).toBeUndefined();
    expect(takeWatchLock(store).ok).toBe(true);
    expect(watchingPid(store)).toBe(process.pid);
  });

  it("isn't held by a later process that was given the same id", () => {
    const store = lockStore();
    // This test's process started long before this record says it took it.
    store.takeWatchHolder(
      { pid: process.pid, at: "2001-01-01T00:00:00Z" },
      () => false,
    );
    expect(watchingPid(store)).toBeUndefined();
    expect(takeWatchLock(store).ok).toBe(true);
  });

  it("frees it when released", () => {
    const store = lockStore();
    releaseOf(takeWatchLock(store))();
    expect(watchingPid(store)).toBeUndefined();
  });

  it("doesn't let a former holder free someone else's", () => {
    const store = lockStore();
    const former = releaseOf(takeWatchLock(store, 99_999_999));
    expect(takeWatchLock(store).ok).toBe(true);
    former();
    expect(watchingPid(store)).toBe(process.pid);
  });
});

const WORKFLOW = {
  schemaVersion: 1 as const,
  name: "triage",
  nodes: { a: { type: "tool.shell" as const, command: "x" } },
  inputs: { issue: { type: "string" as const } },
};

describe("starting a trigger's run", () => {
  const options = {
    id: "t",
    trigger: trigger(),
    workflowFile: "/project/.ork/workflows/triage.ork.yaml",
    workflowHash: "abc",
    runId: "r1",
  };

  it("runs the file that was accepted, by its whole path and text", () => {
    expect(
      triggerRunArgs({
        ...options,
        inputs: { issue: "1" },
        untrusted: ["issue"],
      }).slice(0, 3),
    ).toEqual([
      "run",
      "/project/.ork/workflows/triage.ork.yaml",
      "--expect-workflow=abc",
    ]);
  });

  it("joins each value to its flag, so it can't become another flag", () => {
    const args = triggerRunArgs({
      ...options,
      inputs: { issue: "--allow-dirty --json; echo $(id)" },
      untrusted: ["issue"],
    });
    expect(args).toContain("--input=issue=--allow-dirty --json; echo $(id)");
    expect(args).not.toContain("--allow-dirty");
    expect(args).toContain("--untrusted=issue");
  });

  it("refuses an input the workflow doesn't declare, without starting", async () => {
    const store = lockStore();
    const root = mkdtempSync(path.join(tmpdir(), "ork-watch-"));
    const started = await startTriggerRun({
      ...options,
      store,
      place: { root, mode: "in-repo", dir: path.join(root, ".ork") },
      workflow: WORKFLOW,
      event: { key: "1", inputs: { constructor: "x" } },
    });
    expect(started).toMatchObject({ ok: false });
  });
});

describe("what a terminal shows", () => {
  const ESC = String.fromCodePoint(27);

  it("takes out what could hide a line or forge one", () => {
    expect(plain(`a${ESC}[2Kb${ESC}[1A`)).toBe("ab");
    expect(plain("a\nb\rc")).toBe("a b c");
  });

  const root = "/project";
  const item = {
    place: { root, mode: "in-repo" as const, dir: `${root}/.ork` },
    id: "t",
    trigger: {
      every: "1m",
      run: "triage",
      check: {
        type: "mcp.call" as const,
        server: "gh",
        tool: "list",
        arguments: { repo: "x" },
        env: { TOKEN: "{{env.TOKEN}}" },
      },
    },
    hash: "h",
    workflowFile: `${root}/.ork/workflows/triage.ork.yaml`,
    workflowHash: "w",
    workflow: { ...WORKFLOW, limits: { budgetUsd: 2 } },
    diagnostics: [],
  };

  it("says what changed, and what the run does", () => {
    const lines = acceptLines(item, "changed").join("\n");
    expect(lines).toContain("changed since you accepted it");
    expect(lines).toContain("triage.ork.yaml, up to $2 a run");
    expect(lines).toContain("a: tool.shell");
    expect(lines).toContain('arguments: {"repo":"x"}');
    expect(lines).toContain('env: {"TOKEN":"{{env.TOKEN}}"}');
  });

  it("shows a check's escape sequences as nothing, in the status too", () => {
    const lines = statusLines({
      broken: [],
      triggers: [
        {
          project: "p",
          trigger: "t",
          run: "x",
          every: "1m",
          standing: "live",
          error: `bad${ESC}[2K`,
          problems: [],
          warnings: [],
        },
      ],
    });
    expect(lines.join("\n")).toContain("last look: bad");
    expect(lines.join("\n")).not.toContain(ESC);
  });
});
