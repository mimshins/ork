/**
 * @file What the session runner's legs run with: the session's wiring to Ork's
 *   endpoint, made once before the first leg, then each leg's input and the leg
 *   that fits it: the one-way pipe (`runLeg`), or the duplex leg
 *   (`runDuplexLeg`) for a tool that speaks frames both ways (RFC-027), whose
 *   approval asks go to the run's human channel the way the `claude` CLI's
 *   permission prompt does (`tools/permission.ts`).
 */

import type {
  HumanChannel,
  RuntimeEvent,
  SessionSpec,
  SessionUsage,
} from "@krapht/ork-core";

import type {
  CliAdapter,
  Decision,
  DeferReason,
  LegContext,
  OrkEndpoint,
  Wired,
} from "./adapter.ts";
import type { Leg } from "./leg-step.ts";
import { runDuplexLeg } from "./session-duplex-leg.ts";
import { type DuplexLegInput, type LegInput, runLeg } from "./session-leg.ts";

/** What every leg of a session shares. */
export type LegShared = Omit<
  LegInput,
  "args" | "carried" | "attach" | "decoder"
> & {
  /** The wiring's arguments, after the tool's own. */
  wiredArgs: readonly string[];
  leg: LegContext;
  human: HumanChannel;
  nodeId: string;
  /** The running leg's io, which a duplex leg's can also defer; none after. */
  attach: (io?: {
    write: (line: string) => void;
    stop: () => void;
    defer?: () => void;
  }) => void;
};

/** One leg's input: a duplex one when the adapter speaks a protocol. */
export const legInputOf = (
  shared: LegShared,
  legSpec: SessionSpec,
  carried: SessionUsage | undefined,
  deferredFor?: DeferReason,
): LegInput | DuplexLegInput => {
  const { wiredArgs, human, nodeId, ...rest } = shared;
  const leg =
    deferredFor === undefined ? shared.leg : { ...shared.leg, deferredFor };
  const { protocol, legDecoder } = shared.adapter;
  const common = {
    ...rest,
    args: [...shared.adapter.command.args(legSpec, leg), ...wiredArgs],
    carried,
  };
  if (protocol === undefined) {
    return {
      ...common,
      ...(legDecoder === undefined ? {} : { decoder: legDecoder(legSpec) }),
    };
  }
  return {
    ...common,
    codec: protocol(legSpec),
    spec: legSpec,
    leg,
    // The same ask as the `permission` tool's; the leg denies if it throws.
    permit: (ask, signal) =>
      human
        .permit({ nodeId, toolName: ask.tool, input: ask.args, signal })
        .then((decision): Decision => (decision.allow ? "allow" : "deny")),
  };
};

/**
 * Wires a session to Ork's endpoint, yielding a `session.waiting` event each
 * time the wiring says it waits (a lease waits for its checkout).
 */
export const wireSaying = async function* (
  adapter: CliAdapter,
  spec: SessionSpec,
  endpoint: OrkEndpoint,
  signal: AbortSignal,
  options: {
    bin?: string;
    env?: Readonly<Record<string, string | undefined>>;
    runs?: string;
  },
): AsyncGenerator<RuntimeEvent, Wired> {
  const waits: string[] = [];
  let woke: (() => void) | undefined;
  const woken = (): Promise<false> =>
    new Promise(resolve => {
      woke = () => {
        resolve(false);
      };
    });
  const wiring = adapter.mcp.wire(spec, endpoint, {
    waiting: reason => {
      waits.push(reason);
      woke?.();
    },
    signal,
    bin: options.bin ?? adapter.command.bin,
    env: options.env ?? process.env,
    ...(options.runs === undefined ? {} : { runs: options.runs }),
  });
  const done = wiring.then(
    () => true,
    () => true,
  );
  for (;;) {
    const finished =
      waits.length === 0 &&
      // oxlint-disable-next-line eslint/no-await-in-loop -- one wait at a time
      (await Promise.race([done, woken()]));
    for (const reason of waits.splice(0)) {
      yield { type: "session.waiting", reason };
    }
    if (finished) return wiring;
  }
};

/** Runs the leg its input is for. */
export const runAnyLeg = (
  input: LegInput | DuplexLegInput,
): AsyncGenerator<RuntimeEvent, Leg> =>
  "codec" in input ? runDuplexLeg(input) : runLeg(input);
