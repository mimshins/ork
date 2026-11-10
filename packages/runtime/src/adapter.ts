/**
 * @file The strategies an agent CLI's adapter is made of (RFC-014), one small
 *   type each, and the `CliAdapter` that composes them. The session runner
 *   (`session-runner.ts`) does everything else once: spawning, legs, resuming
 *   between legs, holding a paused node's tool call, interrupting. Adding a
 *   driver is one adapter, registered under its id in `registry.ts`.
 */

import type { RuntimeEvent, SessionSpec, SessionUsage } from "@krapht/ork-core";
import type { DriverId } from "@krapht/ork-integrations";

/** Where a session reaches Ork's MCP endpoint, and its hold hook if any. */
export type OrkEndpoint = { url: string; token: string; holdUrl?: string };

/** What a leg of a session runs with besides its spec. */
export type LegContext = {
  endpoint: OrkEndpoint;
  /** Ork's tools that need no permission prompt, as the tool names them. */
  allowed: readonly string[];
};

/** The program and its arguments for one leg of a session. */
export type Command = {
  /** The program when the runtime names none, found on the PATH. */
  bin: string;
  args: (spec: SessionSpec, leg: LegContext) => string[];
  /**
   * How the brief and later messages reach a running process on stdin, `later`
   * for one sent mid-session. Without it, the brief is in the arguments and a
   * message waits for the next leg, which resumes the session with it.
   */
  input?: (text: string, later: boolean) => string;
};

/** What one output line says. */
export type Decoded = {
  /**
   * Its events: a `session.finished` carries the session id, the outcome and
   * the final report.
   */
  events: RuntimeEvent[];
  /** The line ends a turn whose tool call the hold hook deferred. */
  deferred?: boolean;
};

/** Reads the tool's output, one line at a time. */
export type EventDecoder = (line: string) => Decoded;

/**
 * For a tool whose output has no result line, or whose end needs its exit code:
 * one leg's decoder, which keeps what it read, and once the process exits by
 * itself gives the leg's end (a `session.finished`), or nothing when the exit
 * is a failure to explain.
 */
export type LegDecoder = {
  decode: EventDecoder;
  exit: (code: number | null) => RuntimeEvent[];
};

/** What wiring a session to Ork's endpoint adds to its leg. */
export type Wired = {
  args: string[];
  env: Record<string, string>;
  /** Undoes it once the session ends, also after a failure. */
  release: () => Promise<void>;
};

/** What the session runner gives a wiring that may wait before the tool starts. */
export type WireHooks = {
  /** Says the session waits, and why: the runner emits `session.waiting`. */
  waiting: (reason: string) => void;
  /** Aborted when the session is interrupted; a wait gives up then. */
  signal: AbortSignal;
  /** The program the runner starts, and its environment. */
  bin?: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** The project's runs folder, when the runner was given it. */
  runs?: string;
};

/**
 * How the tool finds Ork's MCP endpoint: a `flag` the Command writes itself, a
 * `config-file` named by an environment variable, or a `lease` on a per-folder
 * entry, where `wire` waits its turn (one session per checkout, `lease.ts`).
 */
export type McpWiring = {
  kind: "flag" | "config-file" | "lease";
  wire: (
    spec: SessionSpec,
    endpoint: OrkEndpoint,
    hooks: WireHooks,
  ) => Promise<Wired>;
};

/**
 * How a node's allow and deny lists reach the tool: rules written up front and
 * nothing asked (`rules`), or a prompt the tool sends to Ork's `permission`
 * tool for the run to answer (`callback`). `denyByDefault`: a tool the node did
 * not allow is refused without a prompt.
 */
export type PermissionPolicy = {
  kind: "rules" | "callback";
  denyByDefault: boolean;
};

/** What the tool reports of its spending. */
export type UsageReader = {
  /** Whether it reports dollars; tokens always. */
  dollars: boolean;
  /** Two legs of one session, as one. */
  combine: (earlier: SessionUsage, later: SessionUsage) => SessionUsage;
};

/** Where the tool reads a repository's context, and how the machine's stays out. */
export type ContextLayers = {
  /** The instruction files it reads, from the repository root. */
  instructions: readonly string[];
  /** The folders its skills and agents come from. */
  skills: string;
  agents: string;
  /** The variables a session adds to keep the machine's setup out. */
  env: (spec: SessionSpec) => Record<string, string>;
};

/**
 * Holding a paused node's next tool call (ADR-041), when the tool can: its
 * hook's answer to "go" or "defer", and how long a call may wait before it is
 * deferred instead.
 */
export type HoldHook = {
  answer: (answer: "go" | "defer") => Record<string, unknown>;
  windowMs: number;
};

/** One agent CLI, as its strategies. */
export type CliAdapter = {
  driver: DriverId;
  command: Command;
  decode: EventDecoder;
  /** A fresh decoder for each leg's spec, used instead of `decode` when set. */
  legDecoder?: (spec: SessionSpec) => LegDecoder;
  mcp: McpWiring;
  permissions: PermissionPolicy;
  usage: UsageReader;
  context: ContextLayers;
  hold?: HoldHook;
};
