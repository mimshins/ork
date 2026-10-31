/**
 * @file `ork chat`'s two paths. A node of a live run gets the message through
 *   the store and the run's socket, and the run's bus pushes it into the node's
 *   session (specs/messaging.md#chat). A node of a finished run gets it by
 *   resuming its last Claude session where it ran, and the exchange is added to
 *   the run's record.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import {
  appendRecorder,
  type Checkout,
  type ClaudeRuntime,
  type EventStore,
  type HumanChannel,
  type NodeOutput,
  planNodeSession,
  type RunRecord,
  socketPath,
  type StoredEvent,
  wakeRun,
  runDirOf,
} from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";

import { loadWorkflow } from "../commands/validate.ts";
import { formatEvent } from "../run/format.ts";

/** What a run's events say about one node's session. */
export type NodeSession = {
  /** Declared in the run, or started in it (a spawned worker). */
  known: boolean;
  /** A leader or worker: a node with a session to talk to. */
  chattable: boolean;
  /** Started and not finished. */
  running: boolean;
  sessionId?: string;
  cwd?: string;
  driver?: Driver;
  /** The node's own worktree, if it had one. */
  checkout?: Checkout;
};

const chattable = (type: string): boolean =>
  type === "claude.leader" || type === "claude.worker";

/** Reads `node`'s session from a run's events, and every node's last output. */
export const nodeSession = (
  events: readonly StoredEvent[],
  node: string,
): { session: NodeSession; outputs: Record<string, NodeOutput> } => {
  const session: NodeSession = {
    known: false,
    chattable: false,
    running: false,
  };
  const outputs: Record<string, NodeOutput> = {};
  for (const { event } of events) {
    if (event.type === "run.started") {
      const declared = event.nodes.find(n => n.id === node);
      if (declared !== undefined) {
        session.known = true;
        session.chattable = chattable(declared.type);
      }
    }
    if (event.type === "node.finished") outputs[event.id] = event.output;
    if (!("id" in event) || event.id !== node) continue;
    if (event.type === "node.started") {
      session.known = true;
      session.chattable = chattable(event.nodeType);
      session.running = true;
    }
    if (event.type === "node.finished") session.running = false;
    if (event.type === "worktree" && event.action === "created") {
      session.checkout = {
        path: event.path,
        ...(event.branch === undefined ? {} : { branch: event.branch }),
        own: true,
        owner: node,
      };
    }
    if (event.type !== "node.event") continue;
    const inner = event.event;
    if (inner.type === "session.started") {
      session.sessionId = inner.sessionId;
      if (inner.cwd !== undefined) session.cwd = inner.cwd;
      if (inner.driver !== undefined) session.driver = inner.driver;
    }
    if (inner.type === "session.finished" && inner.outcome.sessionId !== "") {
      session.sessionId = inner.outcome.sessionId;
    }
  }
  return { session, outputs };
};

/** Sends a live run's node a message; false when the run did not wake. */
export const tellLiveRun = (
  store: EventStore,
  run: RunRecord,
  node: string,
  body: string,
  home?: string,
): Promise<boolean> => {
  store.command(run.id, { kind: "message", node, body });
  return wakeRun(socketPath(run.id, home));
};

export type ResumeChatOptions = {
  store: EventStore;
  run: RunRecord;
  node: string;
  body: string;
  runtime: (driver: Driver) => Promise<ClaudeRuntime>;
  /** Default: the driver the session ran with. */
  driver?: Driver;
  human: HumanChannel;
  out: (line: string) => void;
};

/** The declared node a spawned worker (`<template>-<n>`) is an instance of. */
const templateOf = (
  nodes: Record<string, unknown>,
  id: string,
): string | undefined => {
  if (id in nodes) return undefined;
  const template = id.replace(/-\d+$/u, "");
  return template in nodes ? template : undefined;
};

/**
 * Resumes a finished node's last session with the user's message, prints the
 * session, and adds it to the run's record. Returns why it could not.
 */
export const resumeChat = async (
  options: ResumeChatOptions,
): Promise<string | null> => {
  const { store, run, node } = options;
  const { session, outputs } = nodeSession(store.events(run.id, 0), node);
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
  const runDir = runDirOf(place, run.id);
  const template = templateOf(workflow.nodes, node);
  const plan = planNodeSession(workflow, node, {
    cwd,
    inputs: {},
    outputs,
    inPlace: session.checkout === undefined,
    workflowDir,
    projectRoot: run.project,
    orkDir: place.dir,
    pluginDir: path.join(runDir, "plugins", node),
    ...(session.checkout === undefined ? {} : { checkout: session.checkout }),
    ...(template === undefined ? {} : { template }),
  });
  if (!plan.ok) return plan.error;

  const record = appendRecorder(store, run.id, runDir);
  record({
    type: "user.message",
    node,
    body: options.body,
    delivered: "resumed",
  });
  const runtime = await options.runtime(
    options.driver ?? session.driver ?? plan.driver,
  );
  const started = runtime.start(
    { ...plan.spec, resume: session.sessionId, prompt: options.body },
    { human: options.human },
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
