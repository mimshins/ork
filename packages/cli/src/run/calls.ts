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
  type HumanChannel,
  newRunId,
  type ProjectPlace,
  type RelayPort,
  NOT_STARTED,
  type ResumeState,
  type RunEvent,
  type RunSettings,
} from "@krapht/ork-core";
import { maskedEnv, maskedNamesOfRun } from "@krapht/ork-nodes";
import type { Driver } from "@krapht/ork-schema";

import { resumeChat } from "../runs/chat.ts";
import { runLimits } from "./limits.ts";

export type CallPortsOptions = {
  graph: CompiledGraph;
  store: EventStore;
  runId: string;
  place: ProjectPlace;
  human: HumanChannel;
  emit: (event: RunEvent) => void;
  runtime: (driver: Driver, runs?: string) => Promise<AgentRuntime>;
  out: (line: string) => void;
  home?: string | undefined;
  calledBy?: string | undefined;
  trigger?: string | undefined;
  untrusted?: string[] | undefined;
  budgetCap?: number | undefined;
  baseRef?: string | undefined;
  machineClaude?: boolean | undefined;
  resume?: ResumeState | undefined;
};

export type CallPorts = {
  /** The workflow with its budget capped by the caller's. */
  graph: CompiledGraph;
  calls: CallPort;
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
      emit: options.emit,
      home,
      adopt: adoptedCalls(store, runId),
      newId: () => newRunId(store),
      machineClaude,
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
