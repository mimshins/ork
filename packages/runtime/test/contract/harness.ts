/**
 * @file The contract suite's harness: starts a session of an entry's adapter on
 *   its fake tool, in one scenario, through the shared session runner, and
 *   reads what came of it, so each case stays a few lines with no branches.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  EndKind,
  HumanChannel,
  RuntimeEvent,
  Session,
  SessionOutcome,
  SessionSpec,
} from "@krapht/ork-core";

import { createSessionRuntime } from "../../src/index.ts";
import type { ContractEntry } from "./entries.ts";

export type Scenario =
  | "plain"
  | "invalid-report"
  | "try-denied"
  | "wait-message"
  | "hang"
  | "spend"
  | "report-tool"
  | `end:${EndKind}`;

const human: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "not in this run" }),
};

const specIn = (cwd: string): SessionSpec => ({
  nodeId: "contract",
  cwd,
  prompt: "Do the task",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: [], deny: ["Bash"] },
  permissionMode: "default",
  maxTurns: 5,
  reportSchema: { type: "object" },
});

export type Started = {
  session: Session;
  /** The URL of Ork's endpoint, once the tool has started. */
  endpoint: () => string;
};

/** Starts a session of `entry` on its fake tool (or `bin`), playing `scenario`. */
export const start = (
  entry: ContractEntry,
  scenario: Scenario,
  bin: string = entry.fakeTool,
  spec: Partial<SessionSpec> = {},
): Started => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-contract-"));
  const endpointFile = path.join(cwd, ".endpoint");
  // A throwaway home and runs folder: a tool may keep config per user (Command
  // Code's MCP entries) and Ork keeps leases in the runs folder.
  const home = mkdtempSync(path.join(tmpdir(), "ork-contract-home-"));
  const session = createSessionRuntime(entry.adapter, {
    bin,
    env: {
      ...process.env,
      HOME: home,
      FAKE_SCENARIO: scenario === "plain" ? "" : scenario,
      FAKE_ENDPOINT_FILE: endpointFile,
    },
    runs: path.join(home, "runs"),
  }).start({ ...specIn(cwd), ...spec }, { human });
  return { session, endpoint: () => readFileSync(endpointFile, "utf8") };
};

const drain = async (
  events: AsyncIterator<RuntimeEvent>,
  seen: RuntimeEvent[],
): Promise<RuntimeEvent[]> => {
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- events come in order
    const next = await events.next();
    if (next.done === true) return seen;
    seen.push(next.value);
  }
};

/** Every event of a session, to its end. */
export const collect = (session: Session): Promise<RuntimeEvent[]> =>
  drain(session.events[Symbol.asyncIterator](), []);

/**
 * Every event of a session, doing `act` once it has started: the session's
 * events are pulled one at a time, so `act` runs before the next line is read.
 */
export const collectActing = async (
  session: Session,
  act: () => Promise<void> | void,
): Promise<RuntimeEvent[]> => {
  const events = session.events[Symbol.asyncIterator]();
  const seen: RuntimeEvent[] = [];
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- events come in order
    const next = await events.next();
    if (next.done === true) return seen;
    seen.push(next.value);
    if (next.value.type === "session.started") break;
  }
  await act();
  return drain(events, seen);
};

/** A session's outcome: its last event must be its end. */
export const outcomeOf = (events: readonly RuntimeEvent[]): SessionOutcome => {
  const last = events.at(-1);
  if (last?.type !== "session.finished") {
    throw new Error(`the session did not finish: ${JSON.stringify(last)}`);
  }
  return last.outcome;
};

/**
 * Whether the results of calls to `name` were errors, in order. A tool may
 * prefix the name of an MCP tool (`mcp__ork__report`), so the name it gives
 * need only end with `name`.
 */
export const resultsOf = (
  events: readonly RuntimeEvent[],
  name: string,
): boolean[] => {
  const ids = new Set(
    events.flatMap(e =>
      e.type === "tool.called" && e.name.endsWith(name) ? [e.id] : [],
    ),
  );
  return events.flatMap(e =>
    e.type === "tool.result" && ids.has(e.id) ? [e.isError] : [],
  );
};

/** Whether anything still answers at `url`. */
export const answers = async (url: string): Promise<boolean> => {
  try {
    await fetch(url, { method: "POST", body: "{}" });
    return true;
  } catch {
    return false;
  }
};
