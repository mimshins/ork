/**
 * @file What a run needs to reach other runs: its port for `workflow.call`
 *   nodes (RFC-004), its relay when links are on (RFC-003), and the budget a
 *   caller has capped it to. A called run being resumed keeps its caller and
 *   its cap, which the run recorded, and a run's called runs load the machine's
 *   Claude setup when it does (ADR-065).
 */

import {
  adoptedCalls,
  type CallPort,
  type AgentRuntime,
  type CompiledGraph,
  createCalls,
  createRelay,
  type EventStore,
  type FollowUpSink,
  type GhRunner,
  type HumanChannel,
  newRunId,
  type ProjectPlace,
  type RelayPort,
  NOT_STARTED,
  type ResumeState,
  type RunEvent,
  type RunSettings,
  type StartOptions,
} from "@krapht/ork-core";
import { maskedEnv, maskedNamesOfRun } from "@krapht/ork-nodes";
import type { Driver } from "@krapht/ork-schema";

import { followUpSink } from "../follow-ups/context.ts";
import { resumeChat } from "../runs/chat.ts";
import { runLimits } from "./limits.ts";
import { showCalls } from "./show-calls.ts";
import type { RunWorkflowOptions } from "./workflow-options.ts";

export type CallPortsOptions = Pick<
  RunWorkflowOptions,
  "err" | "json" | "showCalls"
> & {
  graph: CompiledGraph;
  store: EventStore;
  runId: string;
  place: ProjectPlace;
  human: HumanChannel;
  emit: (event: RunEvent) => void;
  runtime: (driver: Driver, runs?: string) => Promise<AgentRuntime>;
  out: (line: string) => void;
  home?: string | undefined;
  /** The person's `gh` for follow-ups kept in GitHub (default: the real one). */
  gh?: GhRunner | undefined;
  calledBy?: string | undefined;
  trigger?: string | undefined;
  untrusted?: string[] | undefined;
  budgetCap?: number | undefined;
  baseRef?: string | undefined;
  machineClaude?: boolean | undefined;
  resume?: ResumeState | undefined;
  detach?: StartOptions["detach"];
};

export type CallPorts = {
  /** The workflow with its budget capped by the caller's. */
  graph: CompiledGraph;
  calls: CallPort;
  /** Keeps what a session's `follow_up` call leaves, as the project's rule says. */
  followUps: FollowUpSink;
  /** The called runs this terminal shows; `end` once the run has ended. */
  shown: ReturnType<typeof showCalls>;
  relay?: RelayPort;
  /** What the run records, for its own resume. */
  settings: Pick<
    RunSettings,
    | "links"
    | "budgetCap"
    | "calledBy"
    | "baseRef"
    | "trigger"
    | "untrusted"
    | "machineClaude"
  >;
};

export const callPorts = (options: CallPortsOptions): CallPorts => {
  const { graph, store, runId, home, human, runtime, out } = options;
  const linksOff = graph.workflow.rules?.links === "off";
  const cap = options.budgetCap ?? options.resume?.settings.budgetCap;
  const calledBy = options.calledBy ?? options.resume?.settings.calledBy;
  const baseRef = options.baseRef ?? options.resume?.settings.baseRef;
  const trigger = options.trigger ?? options.resume?.settings.trigger;
  const untrusted = options.untrusted ?? options.resume?.settings.untrusted;
  const machineClaude =
    options.machineClaude ?? options.resume?.settings.machineClaude ?? false;
  const shown = showCalls(options);
  const own = graph.workflow.limits?.budgetUsd;
  const budgetUsd =
    cap === undefined ? own : Math.min(cap, own ?? Number.POSITIVE_INFINITY);
  return {
    graph: {
      ...graph,
      workflow: {
        ...graph.workflow,
        limits: {
          ...graph.workflow.limits,
          ...(budgetUsd === undefined ? {} : { budgetUsd }),
        },
      },
    },
    calls: createCalls({
      store,
      runId,
      place: options.place,
      emit: event => {
        options.emit(event);
        shown.onEvent(event);
      },
      home,
      adopt: adoptedCalls(store, runId),
      newId: () => newRunId(store),
      machineClaude,
      detach: options.detach,
      env: maskedEnv(
        maskedNamesOfRun(graph.workflow, options.place, store.projects()),
      ),
      resumeSession: (run, node, body, signal) => {
        // A workflow did this, not a person, so the limits hold it as any session.
        const { blocked, leftUsd } = runLimits(
          store,
          options.place,
          home,
        ).now();
        return blocked === undefined
          ? resumeChat({
              store,
              run,
              node,
              body,
              runtime,
              human,
              out,
              signal,
              ...(home === undefined ? {} : { home }),
              ...(leftUsd === undefined ? {} : { budgetLeftUsd: leftUsd }),
            })
          : Promise.resolve(`${NOT_STARTED}${blocked}.`);
      },
    }),
    shown,
    followUps: followUpSink({
      store,
      place: options.place,
      home,
      gh: options.gh,
    }),
    ...(linksOff ? {} : { relay: createRelay({ store, runId, home, human }) }),
    settings: {
      ...(linksOff ? { links: "off" as const } : {}),
      ...(cap === undefined ? {} : { budgetCap: cap }),
      ...(calledBy === undefined ? {} : { calledBy }),
      ...(baseRef === undefined ? {} : { baseRef }),
      ...(trigger === undefined ? {} : { trigger }),
      ...(untrusted === undefined ? {} : { untrusted }),
      ...(machineClaude ? { machineClaude } : {}),
    },
  };
};
