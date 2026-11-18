/**
 * @file Driver checks for tests: which agent drivers are "ready", so a run of
 *   a workflow that names no driver picks one without running a real `claude`
 *   or reading the machine's environment; and a scripted runtime that plays
 *   the two onboarding built-ins' sessions without a model.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  AgentRuntime,
  DriverNeeds,
  RuntimeEvent,
  SessionSpec,
} from "@krapht/ork-core";
import type { DriverCheck, DriverId } from "@krapht/ork-integrations";

import type { DriverChecks } from "../../src/index.ts";

const check = (id: DriverId, ready: boolean): DriverCheck => ({
  id,
  result: ready
    ? { name: `claude (${id} driver)`, status: "ok", detail: `${id} is ready` }
    : {
        name: `claude (${id} driver)`,
        status: "warn",
        detail: `${id} is not ready`,
        hint: `Get the ${id} driver ready.`,
      },
});

/** Checks under which only `ready` pass. */
export const readyOnly =
  (...ready: DriverId[]): DriverChecks =>
  () =>
    Promise.resolve(
      (["open-code", "claude-code", "command-code", "codex"] as const).map(id =>
        check(id, ready.includes(id)),
      ),
    );

/**
 * Only open-code is ready: not the preferred driver, so a test sees which one a
 * run took. The tests' runtimes are stand-ins, so no adapter is needed.
 */
export const openCodeReady = readyOnly("open-code");

/**
 * Descriptors for the tests' stand-in sessions: every driver proven and able,
 * so a test of the run does not meet what a real driver lacks (a turn limit,
 * dollars, a node's own MCP servers).
 * Refusals have their own tests, with descriptors that lack things.
 */
export const standInDrivers: readonly DriverNeeds[] = (
  ["claude-code", "open-code", "command-code", "codex"] as const
).map(id => ({
  id,
  proven: true,
  onePerCheckout: id === "command-code",
  capabilities: {
    questions: true,
    permissionPrompt: true,
    price: true,
    midTurnMessages: true,
    reportSchema: true,
    turnLimit: true,
    mcpServers: true,
    subagents: true,
    readDenies: true,
  },
}));

/** What a scripted session says, for the onboarding flow's two built-ins. */
export type Script = {
  /** The `suggestions` the propose session reports. */
  suggestions: unknown[];
  /** The files the writer leaves in its worktree, one set per round; the last repeats. */
  rounds: Record<string, string>[];
  /** The propose session reports `fail`, so the propose run fails. */
  failPropose?: true;
};

/** A scripted runtime and the specs of the sessions it was asked to start. */
export type Scripted = { runtime: AgentRuntime; specs: SessionSpec[] };

const USAGE = {
  costUsd: 0.01,
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 10,
};

const REPORT_SCHEMA_FIELDS = (script: Script, spec: SessionSpec) =>
  spec.nodeId === "propose" ? { suggestions: script.suggestions } : {};

/**
 * An agent runtime for `driver` that plays a script instead of a model: a
 * session of `propose` reports the script's suggestions, one of `write` leaves
 * the round's files in its own folder (the worktree), and any other node just
 * passes. It stands in at the runtime port, so each driver's flow differs only
 * in the id and the descriptor it is run under.
 */
export const scriptedRuntime = (driver: DriverId, script: Script): Scripted => {
  const specs: SessionSpec[] = [];
  let writes = 0;
  const runtime: AgentRuntime = {
    driver,
    start: spec => {
      specs.push(spec);
      if (spec.nodeId === "write") {
        const files =
          script.rounds[Math.min(writes, script.rounds.length - 1)] ?? {};
        writes += 1;
        for (const [file, text] of Object.entries(files)) {
          const target = path.join(spec.cwd, file);
          mkdirSync(path.dirname(target), { recursive: true });
          writeFileSync(target, text);
        }
      }
      const events = (async function* (): AsyncGenerator<RuntimeEvent> {
        await Promise.resolve();
        yield {
          type: "session.started",
          sessionId: `fake-${String(specs.length)}`,
          model: "fake",
          cwd: spec.cwd,
          driver,
        };
        yield {
          type: "session.finished",
          outcome: {
            subtype: "success",
            sessionId: `fake-${String(specs.length)}`,
            report: {
              status:
                spec.nodeId === "propose" && script.failPropose === true
                  ? "fail"
                  : "pass",
              summary: "done",
              artifacts: {},
              fields: REPORT_SCHEMA_FIELDS(script, spec),
            },
            text: "done",
            usage: USAGE,
            errors: [],
          },
        };
      })();
      return {
        events,
        send: () => {
          // The script asks nothing and is told nothing.
        },
        interrupt: () => Promise.resolve(),
      };
    },
  };
  return { runtime, specs };
};
