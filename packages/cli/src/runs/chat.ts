/**
 * @file `ork chat`'s two paths. A node of a live run gets the message through
 *   the store and the run's socket, and the run's bus pushes it into the node's
 *   session (specs/messaging.md#chat; `tellLiveRun` and `nodeSession` are in
 *   core). A node of a finished run gets it by resuming its last Claude session
 *   where it ran, as the run's sessions were set up (ADR-065), and the exchange
 *   is added to the run's record.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import {
  appendRecorder,
  type AgentRuntime,
  type EventStore,
  type HumanChannel,
  nodeSession,
  planNodeSession,
  type RunRecord,
  placeFiles,
  runDirOf,
  templateOf,
} from "@krapht/ork-core";
import { readyDriver } from "@krapht/ork-integrations";
import { namedMcpEntries } from "@krapht/ork-nodes";
import type { Driver } from "@krapht/ork-schema";

import { loadWorkflow } from "../commands/validate.ts";
import { formatEvent } from "../run/format.ts";
import { chatNotice } from "../run/limits.ts";
import { checksHere, type DriverChecks } from "../run/ready-driver.ts";

export type ResumeChatOptions = {
  store: EventStore;
  /** Where the user's settings are; default: their home. */
  home?: string;
  /** Caps the session; a person chatting has none, a workflow's call does. */
  budgetLeftUsd?: number;
  run: RunRecord;
  node: string;
  body: string;
  runtime: (driver: Driver, runs?: string) => Promise<AgentRuntime>;
  /** Default: the driver the session ran with. */
  driver?: Driver;
  /** The drivers' checks, when nothing names one (default: the real ones). */
  driverChecks?: DriverChecks;
  human: HumanChannel;
  out: (line: string) => void;
  /** Interrupts the session (a caller's stop, for a `workflow.call`). */
  signal?: AbortSignal | undefined;
};

/**
 * The declared node a spawned worker or an item of a fanned node is an instance
 * of.
 */
const instanceOf = (
  nodes: Record<string, unknown>,
  id: string,
): string | undefined =>
  id in nodes ? undefined : templateOf(id, new Set(Object.keys(nodes)));

/** The run's sessions loaded the machine's Claude setup, so this one does. */
const machineClaudeOf = (
  events: ReturnType<EventStore["events"]>,
): { machineClaude?: true } =>
  events.some(
    ({ event }) =>
      event.type === "run.started" && event.settings?.machineClaude === true,
  )
    ? { machineClaude: true }
    : {};

/**
 * Resumes a finished node's last session with the user's message, prints the
 * session, and adds it to the run's record. Returns why it could not.
 */
export const resumeChat = async (
  options: ResumeChatOptions,
): Promise<string | null> => {
  const { store, run, node } = options;
  const events = store.events(run.id, 0);
  const { session, outputs } = nodeSession(events, node);
  if (!session.known) return `${node} is not a node of run ${run.id}.`;
  if (!session.chattable)
    return `${node} is not a leader or worker; only they have sessions to talk to.`;
  if (session.sessionId === undefined) {
    return `${node} has no Claude session to resume in run ${run.id}.`;
  }
  const cwd = session.cwd ?? session.checkout?.path;
  if (cwd === undefined || !existsSync(cwd)) {
    return `${node}'s session ran in ${cwd ?? "a folder Ork did not record"}, which is gone (a merged worktree is removed), so it cannot be resumed.`;
  }
  const { workflow, place, workflowDir } = loadWorkflow(
    run.file,
    path.dirname(run.file),
    undefined,
    store.projects(),
  );
  if (workflow === null) {
    return `The workflow ${run.file} is gone or no longer valid.`;
  }
  const notice = chatNotice(store, place, options.home);
  if (notice !== null) options.out(notice);
  const runDir = runDirOf(place, run.id);
  const template = instanceOf(workflow.nodes, node);
  const plan = planNodeSession(workflow, node, {
    cwd,
    inputs: {},
    outputs,
    inPlace: session.checkout === undefined,
    workflowDir,
    projectRoot: run.project,
    orkDir: place.dir,
    pluginDir: path.join(runDir, "plugins", node),
    ...(options.budgetLeftUsd === undefined
      ? {}
      : { budgetLeftUsd: options.budgetLeftUsd }),
    ...(session.checkout === undefined ? {} : { checkout: session.checkout }),
    ...(template === undefined ? {} : { template }),
  });
  if (!plan.ok) return plan.error;
  const servers = namedMcpEntries(run.project, plan.mcp);
  if (!servers.ok) return servers.error;
  // The session's own driver; one recorded without it takes the one ready.
  let driver = options.driver ?? session.driver ?? plan.driver;
  if (driver === undefined) {
    const ready = readyDriver(await (options.driverChecks ?? checksHere)());
    if (!ready.ok) {
      return ["No Claude driver is ready here.", ...ready.hints].join(" ");
    }
    driver = ready.driver;
  }

  const record = appendRecorder(store, run.id, runDir);
  record({
    type: "user.message",
    node,
    body: options.body,
    delivered: "resumed",
  });
  const runtime = await options.runtime(driver, placeFiles(place).runs);
  const started = runtime.start(
    {
      ...plan.spec,
      ...servers.value,
      resume: session.sessionId,
      prompt: options.body,
      ...machineClaudeOf(events),
    },
    { human: options.human },
  );
  // Stopped while the runtime was loading: no event will come for this.
  if (options.signal?.aborted === true) void started.interrupt();
  options.signal?.addEventListener(
    "abort",
    () => {
      void started.interrupt();
    },
    { once: true },
  );
  const tools = new Map<string, string>();
  let failure: string | null = null;
  for await (const event of started.events) {
    record({ type: "node.event", id: node, event });
    for (const line of formatEvent(node, event, tools)) options.out(line);
    if (
      event.type === "session.finished" &&
      event.outcome.subtype === "error_driver"
    ) {
      failure = event.outcome.errors.join("; ");
    }
  }
  return failure;
};
