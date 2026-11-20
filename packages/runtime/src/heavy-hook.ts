/**
 * @file A session's slot for a heavy Bash call (the project's `heavy` rule),
 *   taken in the hook before a tool call, where a pause holds the call too
 *   (ADR-041): a slot that frees within the hold window lets the call go; past
 *   it the call is deferred, as a pause defers it, and the session resumes once
 *   the slot is taken. The slot is released after the call (the hook after it),
 *   at the session's next call, or at the session's end. The wait itself (its
 *   events, the clock standing still) is the node's machine port.
 */

import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { HoldPort, MachinePort, SessionSpec } from "@krapht/ork-core";

import type { DeferReason, HoldHook } from "./adapter.ts";
import { type HoldAnswer, holdAtTool } from "./hold.ts";
import type { HoldHandler } from "./mcp-http.ts";
import { realOf } from "./tools/contain.ts";
import { shellReadReason, textReadReason } from "./tools/shell-reads.ts";
import { writeOnlyReason } from "./tools/write-limit.ts";

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
export const heavyHook = (machine?: MachinePort): HeavyHook => {
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
      // A stop abandons the wait at once, even when the slot never comes.
      const given = new Promise<null>(resolve => {
        pending.stop.signal.addEventListener("abort", () => {
          resolve(null);
        });
      });
      const release = await Promise.race([pending.slot, given]);
      // Abandoned meanwhile: `abandon` gave it back, or will once it comes.
      if (waiting !== pending || release === null) return;
      waiting = undefined;
      held = { command: pending.command, release, ran: false };
    },
    release: () => {
      abandon();
      free();
    },
  };
};

/**
 * Why a hook's call is refused (RFC-025): a Bash call that reads files, or,
 * with `textReads` refused (a node that cannot edit), a Read of a text file.
 */
export const readRefusalOf = (
  input: unknown,
  textReads: boolean,
): string | undefined => {
  if (!isRecord(input)) return undefined;
  const call = input["tool_input"];
  const field = (key: string): unknown =>
    isRecord(call) ? call[key] : undefined;
  const command = field("command");
  const file = field("file_path");
  if (input["tool_name"] === "Bash" && typeof command === "string") {
    return shellReadReason(command);
  }
  return textReads && input["tool_name"] === "Read" && typeof file === "string"
    ? textReadReason(file)
    : undefined;
};

/** Claude Code's tools that write a file, and the input key naming it. */
const EDIT_TOOLS: Readonly<Record<string, string>> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

/**
 * Why a hook's edit is refused under the write limit (`writeOnly`, relative to
 * `cwd`): its file, links followed, is outside those folders or is named
 * CLAUDE.md or AGENTS.md. The reason tells the session where it may write.
 */
export const writeRefusalOf = (
  input: unknown,
  cwd: string,
  writeOnly: readonly string[],
): string | undefined => {
  if (!isRecord(input)) return undefined;
  const tool = input["tool_name"];
  const key = typeof tool === "string" ? EDIT_TOOLS[tool] : undefined;
  if (typeof tool !== "string" || key === undefined) return undefined;
  const call = input["tool_input"];
  const file = isRecord(call) ? call[key] : undefined;
  const root = realOf(path.resolve(cwd));
  const files =
    typeof file === "string"
      ? [
          file.startsWith("~")
            ? `../${file}`
            : path
                .relative(root, realOf(path.resolve(cwd, file)))
                .split(path.sep)
                .join("/"),
        ]
      : null;
  const why = writeOnlyReason(files, writeOnly);
  return why === undefined
    ? undefined
    : `Ork: ${tool} is ${why}. Do not retry it.`;
};

/**
 * What a session's hook refuses (shell reads, RFC-025; edits outside the write
 * limit), from its spec, for {@link toolHook}; `undefined` when nothing.
 */
export const hookRefusals = (spec: SessionSpec) =>
  spec.reading === "open" && spec.writeOnly === undefined
    ? undefined
    : {
        ...(spec.reading === "extract-only" ? { textReads: true } : {}),
        ...(spec.reading === "open" ? { openReads: true } : {}),
        ...(spec.writeOnly === undefined
          ? {}
          : { writeOnly: { cwd: spec.cwd, folders: spec.writeOnly } }),
      };

/** A node that is never held: the hook only refuses, it never waits. */
export const NEVER_HELD: HoldPort = {
  held: () => false,
  wait: () => Promise.resolve(),
  watch: () => () => {},
};

/** Whether a hook's input is from after a tool call. */
const afterCall = (input: unknown): boolean =>
  isRecord(input) && input["hook_event_name"] === "PostToolUse";

/**
 * A session's hook on its tool calls. A shell read (RFC-025) or an edit outside
 * the write limit is refused first. Before one, a pause holds it (ADR-041),
 * then a heavy Bash call waits for its slot; past the window either defers it
 * (`onDefer`, with which one). After a call, its slot is freed.
 */
export const toolHook =
  (given: {
    hold: HoldPort;
    heavy: HeavyHook;
    answer: HoldHook["answer"];
    windowMs: number;
    ended: AbortSignal;
    onDefer: (reason: DeferReason) => void;
    /** Refuses a shell read before anything else (RFC-025). */
    refuse?: (reason: string) => Record<string, unknown>;
    /** Refuses a Read of a text file too: the node cannot edit. */
    textReads?: boolean;
    /** Leaves shell reads alone (`reading: open`); `refuse` is for writes. */
    openReads?: boolean;
    /** Refuses an edit outside these folders of `cwd` (`writeOnly`). */
    writeOnly?: { cwd: string; folders: readonly string[] };
  }): HoldHandler =>
  async (gone, input) => {
    if (afterCall(input)) {
      given.heavy.after();
      return {};
    }
    const { writeOnly } = given;
    const refused =
      given.refuse === undefined
        ? undefined
        : ((given.openReads === true
            ? undefined
            : readRefusalOf(input, given.textReads === true)) ??
          (writeOnly === undefined
            ? undefined
            : writeRefusalOf(input, writeOnly.cwd, writeOnly.folders)));
    if (refused !== undefined && given.refuse !== undefined) {
      return given.refuse(refused);
    }
    const signal = AbortSignal.any([gone, given.ended]);
    const held = await holdAtTool(given.hold, signal, given.windowMs);
    if (held === "defer") {
      given.onDefer("pause");
      return given.answer(held);
    }
    const slot = await given.heavy.before(input, signal, given.windowMs);
    if (slot === "defer") given.onDefer("slot");
    return given.answer(slot);
  };
