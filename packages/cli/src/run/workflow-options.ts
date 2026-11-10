/** @file What `ork run` for a whole workflow takes (and `ork resume`). */

import type {
  AgentRuntime,
  DriverNeeds,
  EventStore,
  HumanChannel,
  ResumeState,
  RunHandle,
} from "@krapht/ork-core";
import type { ToolRunner } from "@krapht/ork-nodes";
import type { Driver } from "@krapht/ork-schema";

import type { DriverChecks } from "./ready-driver.ts";

export type RunWorkflowOptions = {
  file: string;
  cwd: string;
  /** `name=value` pairs, as given to `--input`. */
  inputs: readonly string[];
  /** Overrides every node's driver. */
  driver?: Driver;
  inPlace: boolean;
  /**
   * Sessions load the machine's MCP servers and auto-memory (ADR-065); a resume
   * reads it from the run's settings.
   */
  machineClaude?: boolean;
  /** Run even when agent files have uncommitted changes (ADR-020). */
  allowDirty?: boolean;
  /** Print the run's events as JSON lines instead of a transcript. */
  json: boolean;
  /** A failed node's hint and scrubbed detail in the transcript. */
  verbose?: boolean;
  runtime: (driver: Driver, runs?: string) => Promise<AgentRuntime>;
  /**
   * The drivers' checks, for nodes that name no driver (default: the real ones,
   * as `ork doctor` runs them).
   */
  driverChecks?: DriverChecks;
  /** The driver descriptors a node is checked against (default: the real ones). */
  drivers?: readonly DriverNeeds[];
  /**
   * The run's own terminal; it races `ork decide` for every question. None for
   * a detached run, whose questions wait for `ork decide`.
   */
  human?: HumanChannel;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Where the run is recorded (`~/.ork/state.db`; tests pass their own). */
  store: EventStore;
  /** Runs tool nodes; the default spawns the real programs. */
  tools?: ToolRunner;
  /**
   * Whether a tool program is installed; default: on `PATH` when `tools` is the
   * real runner.
   */
  installed?: (program: string) => boolean;
  /** The `workflow.call` that started this run, as `<run>/<node>` (RFC-004). */
  calledBy?: string;
  /** The hash the file's text must have, or the run refuses (RFC-011). */
  expectWorkflow?: string;
  /** The trigger that started this run, and what's untrusted of its inputs. */
  trigger?: string;
  untrusted?: string[];
  /** What the caller has left of its budget, which caps this run's. */
  budgetCap?: number;
  /** What this run's worktrees start from, instead of the project's `HEAD`. */
  baseRef?: string;
  /** The run's id; `ork run --detach` picks it before the run starts. */
  runId?: string;
  /** `~`, for the run's socket; tests pass a folder. */
  home?: string;
  /** How often the run looks at the store for answers and commands. */
  intervalMs?: number;
  /** `ork resume`: continue the run `runId` from its recorded state. */
  resume?: ResumeState;
  onRun?: (handle: RunHandle) => void;
};
