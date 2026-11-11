/**
 * @file A session's slot for a heavy Bash call (the project's `heavy` rule),
 *   taken in the hook before a tool call, where a pause holds the call too
 *   (ADR-041): a slot that frees within the hold window lets the call go; past
 *   it the call is deferred, as a pause defers it, and the session resumes once
 *   the slot is taken. The slot is released after the call (the hook after it),
 *   at the session's next call, or at the session's end. The wait itself (its
 *   events, the clock standing still) is the node's machine port.
 */

import { setTimeout as delay } from "node:timers/promises";

import type { HoldPort, MachinePort } from "@krapht/ork-core";

import type { HoldHook } from "./adapter.ts";
import { type HoldAnswer, holdAtTool } from "./hold.ts";
import type { HoldHandler } from "./mcp-http.ts";

export type HeavyHook = {
  /** Before a call: "go" once it may run, "defer" while its slot is not free. */
  before: (
    input: unknown,
    signal: AbortSignal,
    windowMs: number,
  ) => Promise<HoldAnswer>;
  /** After a call: its slot is free. */
  after: () => void;
  /** Resolves once the slot a deferred call waits for is taken. */
  ready: () => Promise<void>;
  /** The session ended: its slot is free, and a wait for one given up. */
  release: () => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The command of a Bash call's hook input, as Claude Code sends it. */
export const bashCommand = (input: unknown): string | undefined => {
  if (!isRecord(input) || input["tool_name"] !== "Bash") return undefined;
  const tool = input["tool_input"];
  const command = isRecord(tool) ? tool["command"] : undefined;
  return typeof command === "string" ? command : undefined;
};

type Held = { command: string; release: () => void; ran: boolean };
type Waiting = {
  command: string;
  slot: Promise<() => void>;
  stop: AbortController;
};

/** The hook for one session; with no machine port, every call goes. */
export const heavyHook = (machine: MachinePort | undefined): HeavyHook => {
  let held: Held | undefined;
  let waiting: Waiting | undefined;

  const free = (): void => {
    held?.release();
    held = undefined;
  };

  /** Gives up the wait; a slot it already got is given back. */
  const abandon = (): void => {
    const pending = waiting;
    waiting = undefined;
    if (pending === undefined) return;
    pending.stop.abort();
    void pending.slot.then(release => {
      release();
      return null;
    });
  };

  return {
    before: async (input, signal, windowMs) => {
      const command = bashCommand(input);
      // The same call, resumed after its slot was taken while it was deferred.
      if (held !== undefined && !held.ran && held.command === command) {
        held.ran = true;
        return "go";
      }
      free();
      // A call other than the one deferred: that wait is over.
      if (waiting !== undefined && waiting.command !== command) abandon();
      if (machine === undefined || command === undefined) return "go";
      if (waiting === undefined) {
        const stop = new AbortController();
        waiting = { command, stop, slot: machine.slot(command, stop.signal) };
      }
      const pending = waiting;
      const window = new AbortController();
      const release = await Promise.race([
        pending.slot,
        delay(windowMs, null, {
          signal: AbortSignal.any([signal, window.signal]),
        }).catch(() => null),
      ]);
      window.abort();
      if (release === null) return signal.aborted ? "go" : "defer";
      waiting = undefined;
      held = { command, release, ran: true };
      return "go";
    },
    after: () => {
      if (held?.ran === true) free();
    },
    ready: async () => {
      const pending = waiting;
      if (pending === undefined) return;
      const release = await pending.slot;
      // Abandoned meanwhile: `abandon` gave it back.
      if (waiting !== pending) return;
      waiting = undefined;
      held = { command: pending.command, release, ran: false };
    },
    release: () => {
      abandon();
      free();
    },
  };
};

/** Whether a hook's input is from after a tool call. */
const afterCall = (input: unknown): boolean =>
  isRecord(input) && input["hook_event_name"] === "PostToolUse";

/**
 * A session's hook on its tool calls. Before one, a pause holds it (ADR-041),
 * then a heavy Bash call waits for its slot; past the window either defers it
 * (`onDefer`). After a call, its slot is freed.
 */
export const toolHook =
  (given: {
    hold: HoldPort;
    heavy: HeavyHook;
    answer: HoldHook["answer"];
    windowMs: number;
    ended: AbortSignal;
    onDefer: () => void;
  }): HoldHandler =>
  async (gone, input) => {
    if (afterCall(input)) {
      given.heavy.after();
      return {};
    }
    const signal = AbortSignal.any([gone, given.ended]);
    let answer = await holdAtTool(given.hold, signal, given.windowMs);
    if (answer === "go") {
      answer = await given.heavy.before(input, signal, given.windowMs);
    }
    if (answer === "defer") given.onDefer();
    return given.answer(answer);
  };
