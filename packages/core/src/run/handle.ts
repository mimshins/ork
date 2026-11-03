/**
 * @file The scheduler's surface: what a run is started with (`RunOptions`),
 *   what a resumed run hands back (`Replay`), the handle a caller drives a live
 *   run with (`RunHandle`: interrupt, pause, continue, stop a node, tell), and
 *   one activation of a node.
 */

import type { CompiledGraph } from "../graph/types.ts";
import type { HumanChannel, RelayPort } from "../runtime/types.ts";
import type { Mail } from "./bus-events.ts";
import type { CallPort } from "./calls.ts";
import type {
  Brief,
  ExecuteContext,
  Inputs,
  NodeExecutors,
  NodeOutput,
  NodeResult,
  NodeSummary,
  RunEvent,
  RunResult,
  RunSettings,
  RunStatus,
  Workspace,
} from "./types.ts";

// The scheduler's whole vocabulary in one place, so it imports it once.
export type {
  ExecuteContext,
  NodeOutput,
  NodeResult,
  NodeSummary,
  RunResult,
  RunStatus,
};

export type RunOptions = {
  graph: CompiledGraph;
  inputs: Inputs;
  cwd: string;
  executors: NodeExecutors;
  human: HumanChannel;
  onEvent: (event: RunEvent) => void;
  runId?: string;
  /** Where nodes work; without one, every node works in `cwd`. */
  workspace?: Workspace;
  /** Run files (tool output beyond the limit); default `<cwd>/.ork/runs/<run>`. */
  runDir?: string;
  /** The workflow file's folder; default `cwd`. */
  workflowDir?: string;
  /** The project's root, which skill and context paths stay in; default `cwd`. */
  projectRoot?: string;
  /** Ork's folder for the project (attached: `~/.ork/projects/<id>`). */
  orkDir?: string;
  /** Recorded in `run.started`. */
  settings?: RunSettings;
  /** For `ork resume`: the results a run recorded, handed back in order. */
  replay?: Replay;
  /** How to reach linked nodes of other runs; none when links are off. */
  relay?: RelayPort;
  /** How `workflow.call` nodes start other workflows (RFC-004). */
  calls?: CallPort;
  /** How long a timed-out node or run may take to end (default 10 s). */
  timeoutGraceMs?: number;
};

/**
 * A resumed run's record (ADR-026). `take` gives an activation its result from
 * last time, or `null` when it must run anew; `ran` marks a new result;
 * `cutOff` gives, once, the session a node was cut off in; `mail`, the bus's.
 */
export type Replay = {
  take: (activation: Activation) => NodeResult | null;
  ran: (result: NodeResult) => void;
  cutOff?: (activation: Activation) => string | undefined;
  mail?: Mail;
};

export type RunHandle = {
  runId: string;
  done: Promise<RunResult>;
  /** Stops starting nodes and aborts the running ones. */
  interrupt: () => void;
  /**
   * Pauses the run, or one node: nothing new starts, and running sessions hold
   * at their next tool call (ADR-041). False when nothing changed.
   */
  pause: (node?: string) => boolean;
  /** Releases what `pause` held; the run's own pause releases every node. */
  proceed: (node?: string) => boolean;
  /**
   * Stops one running node: its session is interrupted and it fails, "stopped
   * by the user"; the run goes on. False when the node is not running.
   */
  stopNode: (node: string) => boolean;
  /** A message from the user to a node's session (`ork chat`). */
  tell: (node: string, body: string) => "now" | "queued" | null;
  /** A message from a linked node of another run (`<run>/<node>`). */
  receive: (node: string, from: string, body: string) => void;
  /** Ork's own line to a node's live session: a link was made or ended. */
  notice: (node: string, text: string) => void;
};

/** One run of a node the scheduler has queued or started. */
export type Activation = {
  id: string;
  input: NodeOutput | undefined;
  /** Set for a run a leader delegated; it reports back and follows no edges. */
  brief?: Brief;
  /** For a spawned worker, the declared node it is an instance of. */
  template?: string;
};
