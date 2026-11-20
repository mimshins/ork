/**
 * @file The strategies an agent CLI's adapter is made of (RFC-014), one small
 *   type each, and the `CliAdapter` that composes them. The session runner
 *   (`session-runner.ts`) does everything else once: spawning, legs, resuming
 *   between legs, holding a paused node's tool call, interrupting. Adding a
 *   driver is one adapter, registered under its id in `registry.ts`.
 */

import type { RuntimeEvent, SessionSpec, SessionUsage } from "@krapht/ork-core";
import type { DriverId } from "@krapht/ork-integrations";

import type { ToolText } from "./tools/tool.ts";

/** Where a session reaches Ork's MCP endpoint, and its hold hook if any. */
export type OrkEndpoint = { url: string; token: string; holdUrl?: string };

/**
 * One Ork tool as a protocol driver offers it to the tool (host tools):
 * `parameters` is the tool's JSON Schema, as the MCP server's `inputSchema`.
 */
export type HostTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  call: (args: unknown) => Promise<ToolText>;
};

/** Why the runner ended a leg at a deferred call: a pause, or a `heavy` slot. */
export type DeferReason = "pause" | "slot";

/** What a leg of a session runs with besides its spec. */
export type LegContext = {
  endpoint: OrkEndpoint;
  /** Ork's tools that need no permission prompt, as the tool names them. */
  allowed: readonly string[];
  /** The session's bound Ork tools, for a driver that declares `hostTools`. */
  hostTools?: readonly HostTool[];
  /**
   * The leg resumes a session whose last leg the runner ended at a deferred
   * call, and why it was deferred: its prompt is no message of the node's, so a
   * codec opens with its own request to make the held call again. Unset on
   * every other leg.
   */
  deferredFor?: DeferReason;
};

/** The program and its arguments for one leg of a session. */
export type Command = {
  /** The program when the runtime names none, found on the PATH. */
  bin: string;
  args: (spec: SessionSpec, leg: LegContext) => string[];
  /**
   * How the brief and later messages reach a running process on stdin, `later`
   * for one sent mid-session. Without it, the brief is in the arguments and a
   * message waits for the next leg, which resumes the session with it. A tool
   * that speaks frames both ways uses `CliAdapter.protocol` instead, never
   * both.
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
  /**
   * What the leg has used so far, when the line reports a model request's
   * usage: the runner stops the session once its counted tokens reach
   * `budgetTokens` (RFC-015).
   */
  usage?: SessionUsage;
  /**
   * With the session's end among the line's events: the end comes while the
   * process still runs (Codex's hook canary), so the runner stops the process
   * at once, as `ork stop` does, and reads nothing after. Ignored on a line
   * with no end.
   */
  kill?: boolean;
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
 * deferred instead. A protocol driver's tool keeps no call pending (`omp`): it
 * answers "defer" by refusing the call, and the runner ends the leg, which the
 * next leg resumes with a request to make the call again.
 */
export type HoldHook = {
  answer: (answer: "go" | "defer") => Record<string, unknown>;
  windowMs: number;
  /**
   * The hook's answer refusing a call, with the reason the session reads; a
   * driver that has it gets the hook on every session that refuses shell reads
   * (RFC-025), not only on one that can be paused.
   */
  refuse?: (reason: string) => Record<string, unknown>;
};

/** One JSON object a protocol driver reads or writes, one per line (RFC-027). */
export type Frame = Record<string, unknown>;

/** A frame Ork writes that the tool answers with a response carrying `id`. */
export type FrameRequest = { id: string; frame: Frame };

/** The tool asking Ork to approve one of its tool calls. */
export type Ask = { id: string; tool: string; args: Record<string, unknown> };

/** The tool calling one of Ork's host tools (`LegContext.hostTools`). */
export type HostCall = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
};

/** Ork's answer to an `Ask`; never "allow for the rest of the session". */
export type Decision = "allow" | "deny";

/**
 * What one frame from the tool says. Its events end the session when they carry
 * a `session.finished` (the tool's settled end, not a turn's end); the client
 * then closes the process, so `deferred` and `kill` do not apply.
 */
export type DecodedFrame = Decoded & {
  /** The handshake is done: the client writes `open`'s frames only after it. */
  ready?: boolean;
  /** The response to a request Ork wrote, with the tool's error if it failed. */
  reply?: { id: string; error?: string };
  /** A question for Ork; the client answers it with `answer`. */
  ask?: Ask;
  /** A tool call the tool makes of Ork; the client answers it with `callResult`. */
  call?: HostCall;
  /** Frames to write back at once, such as a cancel for an ask it can't read. */
  write?: Frame[];
  /**
   * A frame the codec cannot read (such as a chunk of one over the tool's frame
   * limit): the leg ends failed with this one-line diagnostic.
   */
  fail?: string;
};

/**
 * The longest line the client reads from a protocol driver: the 1 MiB frame
 * limit `omp` reports at `ready`, plus slack. A longer line ends the leg
 * failed.
 */
export const MAX_FRAME_LINE_BYTES = 1_048_576 + 65_536;

/**
 * A tool that speaks frames both ways over one long-lived process (RFC-027): a
 * fresh codec for each leg, which keeps what it read (the session id, usage,
 * the tool call an ask is about). The client owns the process and the request
 * ids' pending table; the codec only maps frames.
 */
export type Codec = {
  /**
   * The leg's first requests: the spec's prompt, which on a resumed leg is the
   * message it resumes with, never the first leg's prompt again.
   */
  open: (spec: SessionSpec, leg: LegContext) => FrameRequest[];
  decode: (frame: Frame) => DecodedFrame;
  /**
   * A message to the running session; it reaches the model before the turn
   * ends.
   */
  message: (text: string) => FrameRequest;
  /** Stops the turn; the session settles after it. */
  interrupt: () => FrameRequest;
  answer: (ask: Ask, decision: Decision) => Frame;
  /** The frame that completes a host tool call (`DecodedFrame.call`). */
  callResult: (call: HostCall, result: ToolText) => Frame;
};

/** One agent CLI, as its strategies. */
export type CliAdapter = {
  driver: DriverId;
  command: Command;
  decode: EventDecoder;
  /** A fresh decoder for each leg's spec, used instead of `decode` when set. */
  legDecoder?: (spec: SessionSpec) => LegDecoder;
  /**
   * A fresh codec for each leg's spec, when the tool speaks frames both ways:
   * the runner drives a duplex leg with it, and `command.input` is unset.
   */
  protocol?: (spec: SessionSpec) => Codec;
  /**
   * The tool takes Ork's tools over its protocol (`LegContext.hostTools`), so
   * the runner's HTTP server serves the hold hook only.
   */
  hostTools?: true;
  mcp: McpWiring;
  permissions: PermissionPolicy;
  usage: UsageReader;
  context: ContextLayers;
  hold?: HoldHook;
};
