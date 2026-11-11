/**
 * @file `ork run --node`: checks a workflow and its inputs, plans one Claude
 *   node's session, streams it to the terminal, and records it as a run of one
 *   node.
 */

import path from "node:path";

import {
  type AgentRuntime,
  createFeedback,
  createRecorder,
  createSignals,
  type DriverNeeds,
  type EventStore,
  type HumanChannel,
  inside,
  newRunId,
  parseInputPairs,
  planNodeSession,
  resolveInputs,
  placeFiles,
  runDirOf,
  type RunEvent,
  type Session,
  sessionDriver,
  type SessionOutcome,
  startControl,
  userMessageText,
} from "@krapht/ork-core";
import { namedMcpEntries, resultOf } from "@krapht/ork-nodes";
import type { Driver } from "@krapht/ork-schema";

import {
  formatReport,
  loadWorkflow,
  warningLines,
} from "../commands/validate.ts";
import { createView, formatEvent, formatRunEvent } from "./format.ts";
import { limitsRefusal, runLimits } from "./limits.ts";
import {
  endedFields,
  noteLines,
  oneNodeNotes,
  oneNodeResult,
} from "./node-notes.ts";
import { feedbackOrigin } from "./origin.ts";
import {
  checksHere,
  chooseReadyDriver,
  type DriverChecks,
  unfitLines,
} from "./ready-driver.ts";

export type RunNodeOptions = {
  file: string;
  cwd: string;
  nodeId: string;
  /** `name=value` pairs, as given to `--input`. */
  inputs: readonly string[];
  /** Overrides the node's and the workflow's driver. */
  driver?: Driver;
  inPlace: boolean;
  /** The session loads the machine's Claude setup (ADR-065). */
  machineClaude?: boolean;
  /** Print the runtime events as JSON lines instead of a transcript. */
  json: boolean;
  /** A failed node's hint and scrubbed detail in the transcript. */
  verbose?: boolean;
  runtime: (driver: Driver, runs?: string) => Promise<AgentRuntime>;
  /** The drivers' checks, when the node names none (default: the real ones). */
  driverChecks?: DriverChecks;
  /**
   * The driver descriptors the node is checked against (default: the real
   * ones).
   */
  drivers?: readonly DriverNeeds[];
  /** The terminal; it races `ork decide`. None: questions wait for `ork decide`. */
  human?: HumanChannel;
  /** `~`, for the run's socket; tests pass a folder. */
  home?: string;
  /** The run's id; `ork run --detach` picks it before the run starts. */
  runId?: string;
  /** Where the run is recorded (`~/.ork/state.db`; tests pass their own). */
  store: EventStore;
  out: (line: string) => void;
  err: (line: string) => void;
  onSession?: (session: Session) => void;
};

export type RunNodeResult = {
  exitCode: number;
  outcome: SessionOutcome | null;
};

const succeeded = (outcome: SessionOutcome | null): boolean =>
  outcome?.report !== null &&
  outcome?.report !== undefined &&
  outcome.report.status !== "fail";

/**
 * Runs one Claude node of a workflow on its own: checks the workflow and the
 * inputs, plans the session, and streams it to the terminal.
 */
export const runNode = async (
  options: RunNodeOptions,
): Promise<RunNodeResult> => {
  const failed = (lines: string[]): RunNodeResult => {
    for (const line of lines) options.err(line);
    return { exitCode: 1, outcome: null };
  };

  const { report, workflow, graph, place, workflowDir } = loadWorkflow(
    options.file,
    options.cwd,
    options.home,
    options.store.projects(),
  );
  if (workflow === null) return failed(formatReport(report));
  for (const line of warningLines(report)) options.err(line);

  const pairs = parseInputPairs(options.inputs);
  if (!pairs.ok) return failed([`--input: ${pairs.error}`]);
  const inputs = resolveInputs(workflow, pairs.raw);
  if (!inputs.ok) return failed(inputs.errors);

  const notes = oneNodeNotes(workflow, options.nodeId);
  if (notes.error !== undefined) return failed([notes.error]);
  const limits = runLimits(options.store, place, options.home);
  const refused = limitsRefusal(limits, workflow);
  if (refused.length > 0) return failed(refused);
  const left = limits.now().leftUsd;

  const projectRoot = place.root;
  const runId = options.runId ?? newRunId(options.store, "node-");
  const runDir = runDirOf(place, runId);
  // An attached project's workflow can be run from anywhere; the node works in
  // the project then.
  const cwd = inside(projectRoot, options.cwd) ? options.cwd : projectRoot;
  const plan = planNodeSession(workflow, options.nodeId, {
    ...(left === undefined ? {} : { budgetLeftUsd: left }),
    cwd,
    inputs: inputs.inputs,
    inPlace: options.inPlace,
    workflowDir,
    projectRoot,
    orkDir: place.dir,
    pluginDir: path.join(runDir, "plugins", options.nodeId),
  });
  if (!plan.ok) return failed([plan.error]);
  const servers = namedMcpEntries(projectRoot, plan.mcp);
  if (!servers.ok) return failed([servers.error]);
  // Before the session starts: the driver ready here, when nothing names one.
  const named = sessionDriver({
    override: options.driver,
    named: plan.driver,
    pinned: plan.pinned,
  });
  const ready =
    named === undefined
      ? chooseReadyDriver(
          [options.nodeId],
          true,
          await (options.driverChecks ?? checksHere)(),
        )
      : null;
  if (ready?.ok === false) return failed(ready.lines);
  if (ready?.line !== undefined) options.err(ready.line);
  const driver = named ?? ready?.driver;
  if (driver === undefined) return failed(["No agent driver is ready here."]);
  const unfit = unfitLines(workflow, options.drivers, {
    override: driver,
    only: options.nodeId,
  });
  if (unfit.length > 0) return failed(unfit);
  for (const line of noteLines([...notes.warnings, ...plan.warnings])) {
    options.err(line);
  }

  const id = options.nodeId;
  const recorder = createRecorder(
    options.store,
    {
      id: runId,
      workflow: workflow.name,
      file: path.resolve(options.cwd, options.file),
      project: projectRoot,
    },
    runDir,
  );
  const started = Promise.withResolvers<Session>();
  const control = await startControl({
    store: options.store,
    runId,
    emit: event => {
      record(event);
    },
    onStop: () => {
      void started.promise.then(session => session.interrupt());
    },
    onMessage: (node, body) => {
      if (node !== id) return;
      void (async () => {
        (await started.promise).send(userMessageText(body));
        record({ type: "user.message", node, body, delivered: "now" });
      })();
    },
    ...(options.human === undefined ? {} : { local: options.human }),
    ...(options.home === undefined ? {} : { home: options.home }),
  });
  const signals = createSignals(
    feedbackOrigin(path.resolve(options.cwd, options.file)),
  );
  const view = createView();
  const record = (raw: RunEvent): void => {
    for (const event of signals(raw)) {
      control.publish(recorder(event));
      // The session's own events are printed as they stream.
      if (event.type === "feedback.recorded" && !options.json) {
        for (const line of formatRunEvent(
          event,
          id.length,
          new Map(),
          false,
          options.verbose,
          view,
        )) {
          options.out(line);
        }
      }
    }
  };
  const nodeType = workflow.nodes[id]?.type ?? "agent.worker";
  record({
    type: "run.started",
    runId,
    workflow: workflow.name,
    entries: [id],
    nodes: [{ id, type: nodeType }],
    ...(options.machineClaude === true
      ? { settings: { machineClaude: true } }
      : {}),
  });
  record({ type: "node.started", id, nodeType, round: 1 });

  const runtime = await options.runtime(driver, placeFiles(place).runs);
  if (options.machineClaude === true) plan.spec.machineClaude = true;
  const session = runtime.start(
    { ...plan.spec, ...servers.value },
    {
      human: control.human,
      ...(graph === null
        ? {}
        : { feedback: createFeedback({ graph, onEvent: record }).port(id) }),
    },
  );
  started.resolve(session);
  options.onSession?.(session);

  const tools = new Map<string, string>();
  let outcome: SessionOutcome | null = null;
  for await (const event of session.events) {
    record({ type: "node.event", id, event });
    if (event.type === "session.finished") outcome = event.outcome;
    if (options.json) options.out(JSON.stringify(event));
    else
      for (const line of formatEvent(
        options.nodeId,
        event,
        tools,
        options.verbose,
        view,
      )) {
        options.out(line);
      }
  }
  const result = resultOf(outcome);
  record({
    type: "node.finished",
    id,
    round: 1,
    ok: result.ok,
    output: result.output,
    ...(result.usage === undefined ? {} : { usage: result.usage }),
    ...endedFields(result),
  });
  record({
    type: "run.finished",
    result: oneNodeResult(runId, id, result, succeeded(outcome)),
  });
  await control.close();
  return { exitCode: succeeded(outcome) ? 0 : 1, outcome };
};

/** Every value of a repeatable flag: `--input a=1 --input=b=2`. */
