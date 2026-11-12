/**
 * @file End-to-end tests for a run's `limits.budgetTokens` reserves (ADR-077,
 *   RFC-015) through `ork run`, the run's spend and each node's context: a
 *   worker that finds nothing left waits for its sibling's reserve to free and
 *   starts with what that sibling left, or is refused once the run's tokens are
 *   spent. The runtime is the stand-in `claude`, which counts 125 tokens a
 *   session.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type AgentRuntime,
  openStore,
  type SessionSpec,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runWorkflowFile } from "../src/index.ts";
import { readyOnly } from "./fixtures/drivers.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

/** A leader capped at 1 token, then two uncapped workers it owns, side by side. */
const workflowOf = (budgetTokens: number): string =>
  [
    "schemaVersion: 1",
    "name: shares",
    "limits:",
    `  budgetTokens: ${String(budgetTokens)}`,
    "nodes:",
    "  lead:",
    "    type: agent.leader",
    "    isolation: shared",
    "    budgetTokens: 1",
    '    prompt: "Lead"',
    "  w1:",
    "    type: agent.worker",
    "    parent: lead",
    "    isolation: shared",
    '    prompt: "One"',
    "  w2:",
    "    type: agent.worker",
    "    parent: lead",
    "    isolation: shared",
    '    prompt: "Two"',
    "edges:",
    "  - lead -> w1",
    "  - lead -> w2",
    "",
  ].join("\n");

const quiet = () => {
  // The transcript isn't what these check.
};

/** Runs the workflow under `budgetTokens`, keeping each session's spec. */
const runUnder = async (budgetTokens: number) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-reserves-")));
  writeFileSync(path.join(dir, "shares.ork.yaml"), workflowOf(budgetTokens));
  const store = openStore(":memory:");
  const specs: SessionSpec[] = [];
  const inner = createCliRuntime({ bin: FAKE_CLAUDE });
  const runtime: AgentRuntime = {
    driver: "claude-code",
    start: (spec, ports) => {
      specs.push(spec);
      return inner.start(spec, ports);
    },
  };
  const done = await runWorkflowFile({
    file: "shares.ork.yaml",
    cwd: dir,
    inputs: [],
    inPlace: true,
    json: false,
    runtime: () => Promise.resolve(runtime),
    driverChecks: readyOnly("claude-code"),
    human: {
      ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
      permit: () => Promise.resolve({ allow: false, message: "no" }),
    },
    store,
    home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
    out: quiet,
    err: quiet,
  });
  const caps = specs.map(spec => [
    spec.prompt.split("\n")[0],
    spec.budgetTokens,
  ]);
  return { done, caps };
};

beforeEach(() => {
  vi.stubEnv("FAKE_CLAUDE_NO_ASK", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a run's budgetTokens reserves, end to end", () => {
  it("makes a worker wait for its sibling's reserve, then start with what is left", async () => {
    const { done, caps } = await runUnder(400);
    // lead used 125; w1 set aside the other 275, so w2 found nothing and
    // waited; w1 used 125 of it, which leaves w2 400 - 125 - 125.
    expect(caps).toEqual([
      ["Lead", 1],
      [expect.any(String), 275],
      [expect.any(String), 150],
    ]);
    expect(done.result).toMatchObject({ status: "succeeded", tokens: 375 });
    expect(done.exitCode).toBe(0);
  });

  it("refuses the waiting worker once the run's tokens are spent", async () => {
    const { done, caps } = await runUnder(200);
    // lead used 125 and w1 125 of its 75: 250 of 200, nothing to wait for.
    expect(caps).toEqual([
      ["Lead", 1],
      [expect.any(String), 75],
    ]);
    expect(done.result?.tokens).toBe(250);
    expect(
      done.result?.nodes.map(({ ok, end, output }) => [
        ok,
        end?.kind,
        output?.["summary"],
      ]),
    ).toContainEqual([
      false,
      "budget_limit",
      "not started: nothing is left of the run's tokens",
    ]);
  });
});
